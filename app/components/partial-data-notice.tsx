export interface PartialDataNoticeProps {
  message: string;
}

export function PartialDataNotice({ message }: PartialDataNoticeProps) {
  return (
    <p className="f9-dash-state f9-dash-state-partial" role="status">
      {message}
    </p>
  );
}
