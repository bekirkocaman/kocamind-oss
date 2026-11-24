export type Tab = {
  id: string;
  name: string;
  content: string;
  savedContent: string;
  language: string;
};

export type TabsState = {
  tabs: Tab[];
  activeId: string | null;
};

export type TabsAction =
  | { type: 'open'; tab: Tab }
  | { type: 'activate'; id: string }
  | { type: 'update'; id: string; content: string }
  | { type: 'saved'; id: string; content: string }
  | { type: 'close'; id: string }
  | { type: 'closeAll' }
  | { type: 'rename'; fromPath: string; toPath: string }
  | { type: 'removeUnder'; path: string }
  | { type: 'reload'; id: string; content: string };

export const initialTabsState: TabsState = {
  tabs: [],
  activeId: null,
};

export function isDirty(tab: Tab): boolean {
  return tab.content !== tab.savedContent;
}

function getBaseName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

function renamePath(id: string, fromPath: string, toPath: string): string {
  if (id === fromPath) return toPath;
  if (id.startsWith(fromPath + '/')) {
    return toPath + id.slice(fromPath.length);
  }
  return id;
}

function isUnderPath(id: string, targetPath: string): boolean {
  return id === targetPath || id.startsWith(targetPath + '/');
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open': {
      const existing = state.tabs.find((t) => t.id === action.tab.id);
      if (existing) {
        return state.activeId === existing.id
          ? state
          : { ...state, activeId: existing.id };
      }
      return {
        tabs: [...state.tabs, action.tab],
        activeId: action.tab.id,
      };
    }

    case 'activate': {
      if (!state.tabs.some((t) => t.id === action.id)) return state;
      return state.activeId === action.id ? state : { ...state, activeId: action.id };
    }

    case 'update': {
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id ? { ...t, content: action.content } : t
        ),
      };
    }

    case 'saved': {
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id ? { ...t, savedContent: action.content } : t
        ),
      };
    }

    case 'close': {
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      if (idx === -1) return state;
      const nextTabs = state.tabs.filter((t) => t.id !== action.id);
      let nextActiveId = state.activeId;
      if (state.activeId === action.id) {
        if (nextTabs.length === 0) {
          nextActiveId = null;
        } else if (idx < nextTabs.length) {
          nextActiveId = nextTabs[idx].id;
        } else {
          nextActiveId = nextTabs[idx - 1].id;
        }
      }
      return { tabs: nextTabs, activeId: nextActiveId };
    }

    case 'closeAll': {
      return initialTabsState;
    }

    case 'rename': {
      const nextTabs = state.tabs.map((t) => {
        const nextId = renamePath(t.id, action.fromPath, action.toPath);
        if (nextId === t.id) return t;
        return { ...t, id: nextId, name: getBaseName(nextId) };
      });
      const nextActiveId = state.activeId
        ? renamePath(state.activeId, action.fromPath, action.toPath)
        : null;
      return { tabs: nextTabs, activeId: nextActiveId };
    }

    case 'removeUnder': {
      const removedActive =
        state.activeId !== null && isUnderPath(state.activeId, action.path);
      const oldIdx = removedActive
        ? state.tabs.findIndex((t) => t.id === state.activeId)
        : -1;
      const nextTabs = state.tabs.filter((t) => !isUnderPath(t.id, action.path));
      let nextActiveId = state.activeId;
      if (removedActive) {
        if (nextTabs.length === 0) {
          nextActiveId = null;
        } else if (oldIdx < nextTabs.length) {
          nextActiveId = nextTabs[oldIdx].id;
        } else {
          nextActiveId = nextTabs[nextTabs.length - 1].id;
        }
      }
      return { tabs: nextTabs, activeId: nextActiveId };
    }

    case 'reload': {
      return {
        ...state,
        tabs: state.tabs.map((t) => {
          if (t.id !== action.id || isDirty(t)) return t;
          return { ...t, content: action.content, savedContent: action.content };
        }),
      };
    }
  }
}
