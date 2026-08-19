export function SettingsActionRow({
  onReset,
  onSaveDefault,
}: {
  onReset: () => void;
  onSaveDefault?: () => void;
}) {
  return (
    <div className="fp-drawer__actions">
      {onSaveDefault ? (
        <button type="button" className="fp-drawer__reset fp-drawer__reset--save" onClick={onSaveDefault}>
          Uložit jako výchozí
        </button>
      ) : null}
      <button type="button" className="fp-drawer__reset" onClick={onReset}>
        Výchozí
      </button>
    </div>
  );
}
