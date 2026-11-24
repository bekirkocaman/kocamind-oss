import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type TreeMenuTarget = {
  x: number;
  y: number;
  path: string;
  name: string;
  type: 'root' | 'folder' | 'file';
};

export type TreeMenuAction = 'newFile' | 'newFolder' | 'rename' | 'delete';

type TreeMenuProps = {
  target: TreeMenuTarget | null;
  onClose: () => void;
  onAction: (action: TreeMenuAction) => void;
};

type MenuPosition = {
  left: number;
  top: number;
  originX: string;
  originY: string;
};

const VIEWPORT_MARGIN = 8;

export function TreeMenu({ target, onClose, onAction }: TreeMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<MenuPosition>({
    left: 0,
    top: 0,
    originX: '0px',
    originY: '0px',
  });

  useLayoutEffect(() => {
    if (!target || !menuRef.current) return;

    const rect = menuRef.current.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);

    const left = Math.max(VIEWPORT_MARGIN, Math.min(target.x, maxLeft));
    const top = Math.max(VIEWPORT_MARGIN, Math.min(target.y, maxTop));

    const ox = Math.max(0, Math.min(rect.width, target.x - left));
    const oy = Math.max(0, Math.min(rect.height, target.y - top));

    setPosition({
      left,
      top,
      originX: `${Math.round(ox)}px`,
      originY: `${Math.round(oy)}px`,
    });
  }, [target]);

  useEffect(() => {
    if (!target) return;

    menuRef.current?.focus({ preventScroll: true });

    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const handleResize = () => {
      onClose();
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [target, onClose]);

  if (!target) return null;

  const getMenuItems = (): HTMLButtonElement[] => {
    if (!menuRef.current) return [];
    return Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = getMenuItems();
    if (items.length === 0) return;

    const currentIdx = items.indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % items.length;
      items[nextIdx].focus();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = currentIdx < 0 ? items.length - 1 : (currentIdx - 1 + items.length) % items.length;
      items[prevIdx].focus();
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      key={`${target.x}-${target.y}-${target.path}`}
      ref={menuRef}
      role="menu"
      aria-label="Dosya işlemleri"
      tabIndex={-1}
      className="ag-context-menu"
      style={{
        top: position.top,
        left: position.left,
        transformOrigin: `${position.originX} ${position.originY}`,
      }}
      onKeyDown={handleMenuKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="ag-context-menu-item"
        onClick={() => onAction('newFile')}
      >
        Yeni dosya
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="ag-context-menu-item"
        onClick={() => onAction('newFolder')}
      >
        Yeni klasör
      </button>
      {target.type !== 'root' && (
        <>
          <div className="ag-context-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ag-context-menu-item"
            onClick={() => onAction('rename')}
          >
            Yeniden adlandır
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ag-context-menu-item danger"
            onClick={() => onAction('delete')}
          >
            Sil
          </button>
        </>
      )}
    </div>
  );
}
