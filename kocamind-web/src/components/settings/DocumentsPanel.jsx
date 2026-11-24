import { IconClose, IconDelete, IconUpload } from "../icons.jsx";
import { SettingsGroup } from "./Fields";

export default function DocumentsPanel({
  currentUser,
  docInputRef,
  handleDocPick,
  documentsLoading,
  documentsLoadingMore = false,
  documentsError = null,
  documents = [],
  documentsNextCursor = null,
  documentsTruncated = false,
  uploadProgress = null,
  onCancelUpload,
  onLoadMoreDocuments,
  onRetryDocuments,
  onDeleteDocument,
}) {
  const isUploading = Boolean(uploadProgress);
  const hasMore = documentsNextCursor !== null && documentsNextCursor !== undefined;
  const isTruncated = Boolean(documentsTruncated) || documents.some(d => Boolean(d?.partial));

  return (
    <div className="settings-section">
      <h3>Dokümanlar</h3>
      <div className="settings-intro-row">
        <p className="settings-hint">
          {currentUser
            ? 'Metin tabanlı dosyalar yükleyip sohbetlerde kaynak olarak kullanabilirsin.'
            : 'Doküman yükleyip üzerinde soru-cevap yapmak için giriş yapmalısın.'}
        </p>
        {currentUser && (
          <button
            type="button"
            className="mini-btn"
            disabled={isUploading}
            onClick={() => docInputRef.current?.click()}
          >
            <IconUpload size={13} /> Yükle
          </button>
        )}
      </div>

      <input
        type="file"
        ref={docInputRef}
        style={{ display: 'none' }}
        accept=".txt,.md,.csv,.json,.js,.ts,.py,.xml,.html,.css,.log"
        onChange={handleDocPick}
      />

      {currentUser && (
        <>
          {isUploading && (
            <div className="settings-note doc-upload-card">
              <div className="doc-upload-head">
                <span className="km-row-label">
                  {uploadProgress.percent >= 100
                    ? `${uploadProgress.fileName} · İndeksleniyor...`
                    : `${uploadProgress.fileName} · %${uploadProgress.percent}`}
                </span>
                {onCancelUpload && (
                  <button type="button" className="mini-btn" onClick={onCancelUpload}>
                    <IconClose size={13} /> İptal
                  </button>
                )}
              </div>
              <div
                className="usage-bar"
                role="progressbar"
                aria-label="Doküman yükleme ilerlemesi"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadProgress.percent}
              >
                <span style={{ width: `${uploadProgress.percent}%` }} />
              </div>
            </div>
          )}

          {documentsError && (
            <div className="settings-error-row" role="alert">
              <span>{documentsError}</span>
              {onRetryDocuments && (
                <button type="button" className="mini-btn" onClick={onRetryDocuments}>
                  Tekrar dene
                </button>
              )}
            </div>
          )}

          {isTruncated && (
            <div className="settings-note" role="status">
              Çok fazla doküman parçası var; liste ve parça sayıları eksik olabilir.
            </div>
          )}

          {documentsLoading && documents.length === 0 ? (
            <p className="settings-hint">Yükleniyor...</p>
          ) : documents.length === 0 && !documentsError ? (
            <p className="settings-hint">Henüz doküman yok. Metin tabanlı bir dosya yükle.</p>
          ) : documents.length > 0 ? (
            <>
              <SettingsGroup>
                {documents.map(d => (
                  <div key={d.documentId} className="km-row">
                    <div className="km-row-text">
                      <span className="km-row-label">{d.fileName}</span>
                      <span className="km-row-desc settings-tabular">
                        {d.chunksCount}{d.partial ? '+' : ''} parça · {new Date(d.uploadedAt).toLocaleDateString('tr-TR')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="row-delete-btn"
                      onClick={() => onDeleteDocument(d.documentId)}
                      title="Sil"
                      aria-label={`${d.fileName} dokümanını sil`}
                    >
                      <IconDelete size={15} />
                    </button>
                  </div>
                ))}
              </SettingsGroup>
              {hasMore && onLoadMoreDocuments && (
                <button
                  type="button"
                  className="mini-btn"
                  disabled={documentsLoadingMore}
                  onClick={onLoadMoreDocuments}
                  style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                >
                  {documentsLoadingMore ? 'Yükleniyor...' : 'Daha fazla yükle'}
                </button>
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
