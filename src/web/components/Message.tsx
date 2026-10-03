interface MessageProps {
  kind: "error" | "success";
  children: string;
}

const STYLES = {
  error: "bg-red-50 text-red-700",
  success: "bg-emerald-50 text-emerald-700",
};

export function Message({ kind, children }: MessageProps) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${STYLES[kind]}`}>
      {children}
    </p>
  );
}
