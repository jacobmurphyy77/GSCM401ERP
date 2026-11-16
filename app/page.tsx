export default function Home() {
  return (
    <main className="page-shell">
      <section className="welcome-card">
        <p className="eyebrow">Supply Chain Operations</p>
        <h1>ERP workspace</h1>
        <p className="intro">
          Your application foundation is ready. Add the first workflow after
          defining its data, permissions, and approval steps.
        </p>
        <div className="setup-note">
          <strong>Next step</strong>
          <span>
            Add your Supabase publishable key to <code>.env.local</code> to
            enable the database clients.
          </span>
        </div>
      </section>
    </main>
  );
}
