export const metadata = { title: "Groundwork" };

export default async function Login({ searchParams }: { searchParams: Promise<{ wrong?: string }> }) {
  const { wrong } = await searchParams;
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg, #f6f4ef)", padding: 20 }}>
      <form method="post" action="/api/login" className="card" style={{ width: "min(400px, 100%)", padding: 28, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: "#2e9e5b", boxShadow: "0 2px 0 #23794a", display: "inline-block" }} />
          <b style={{ fontFamily: "var(--font-round)", fontSize: 22 }}>Groundwork</b>
        </div>
        <p style={{ margin: 0, color: "#55524b", fontSize: 15 }}>A research desk for angel investors, built on Cala’s public data. Enter the demo password to continue.</p>
        <input className="field" type="password" name="password" placeholder="Password" autoFocus required aria-label="Password" />
        {wrong && <span style={{ color: "#c0392b", fontSize: 14 }}>That password didn’t work.</span>}
        <button className="btn primary" type="submit">Open Groundwork</button>
      </form>
    </main>
  );
}
