export function OneInput({
  label,
  placeholder,
  name,
  action,
  message,
}: {
  label: string;
  placeholder: string;
  name: string;
  action: string;
  message?: string | undefined;
}) {
  return (
    <form method="post" action={action}>
      <input
        name={name}
        placeholder={placeholder}
        aria-label={label}
        autoFocus
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
