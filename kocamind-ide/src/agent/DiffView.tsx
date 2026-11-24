import { collapseContext, diffLines, type DiffLine } from './diff.ts';

type DiffViewProps = {
  path: string;
  before: string | null;
  after: string;
};

export function DiffView({ path, before, after }: DiffViewProps) {
  const { lines, tooLarge } = diffLines(before, after);

  if (tooLarge) {
    return (
      <div className="ag-agent-diff">
        <div className="ag-agent-diff-header">
          <span className="ag-agent-diff-path">{path}</span>
        </div>
        <div className="ag-agent-diff-too-large">
          Dosya çok büyük, fark gösterilemiyor.
        </div>
      </div>
    );
  }

  const addCount = lines.filter((l: DiffLine) => l.type === 'add').length;
  const delCount = lines.filter((l: DiffLine) => l.type === 'del').length;

  const collapsed = collapseContext(lines, 3);
  const maxRows = 400;
  const displayed = collapsed.slice(0, maxRows);
  const extraCount = collapsed.length - displayed.length;

  return (
    <div className="ag-agent-diff">
      <div className="ag-agent-diff-header">
        <span className="ag-agent-diff-path" title={path}>{path}</span>
        <span className="ag-agent-diff-stats">
          <span className="ag-agent-diff-add">+{addCount}</span>
          {' '}
          <span className="ag-agent-diff-del">−{delCount}</span>
        </span>
      </div>

      <div className="ag-agent-diff-content">
        <table className="ag-agent-diff-table">
          <tbody>
            {displayed.map((item, idx) => {
              if (item.type === 'skip') {
                return (
                  <tr key={`skip-${idx}`} className="ag-agent-diff-row skip">
                    <td colSpan={3} className="ag-agent-diff-cell-skip">
                      … {item.count} satır değişmedi
                    </td>
                  </tr>
                );
              }

              const rowClass =
                item.type === 'add'
                  ? 'ag-agent-diff-row add'
                  : item.type === 'del'
                  ? 'ag-agent-diff-row del'
                  : 'ag-agent-diff-row same';

              const prefix =
                item.type === 'add' ? '+' : item.type === 'del' ? '-' : ' ';

              return (
                <tr key={`line-${idx}`} className={rowClass}>
                  <td className="ag-agent-diff-num old">
                    {item.oldNo ?? ''}
                  </td>
                  <td className="ag-agent-diff-num new">
                    {item.newNo ?? ''}
                  </td>
                  <td className="ag-agent-diff-text">
                    <span className="ag-agent-diff-sign">{prefix}</span>
                    {item.text}
                  </td>
                </tr>
              );
            })}

            {extraCount > 0 && (
              <tr className="ag-agent-diff-row more">
                <td colSpan={3} className="ag-agent-diff-cell-more">
                  … {extraCount} satır daha
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DiffView;
