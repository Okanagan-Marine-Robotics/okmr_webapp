// Small red "something new here" indicator. Has no hooks, so it works inside
// both the client-side top tabs and the server-rendered Forms subtabs.
export function UnreadDot() {
  return (
    <span
      role="status"
      aria-label="new"
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: "#e5484d",
        marginLeft: 6,
        verticalAlign: "middle",
      }}
    />
  );
}
