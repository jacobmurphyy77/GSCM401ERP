"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";
import { employeeRoles, employeeRoleDescriptions, EmployeeRole, EmployeeRecord, generateTemporaryPassword, validEmployeePassword } from "@/src/lib/employee-management";

async function functionError(error: unknown, fallback: string) {
  const context = error && typeof error === "object" && "context" in error ? error.context : undefined;
  if (context instanceof Response) {
    try {
      const body = await context.json();
      if (typeof body.error === "string") return body.error;
      if (typeof body.message === "string") return body.message;
    } catch { /* Retain a useful nontechnical fallback. */ }
  }
  return fallback;
}

export function EmployeeManagement({ role, onChanged, functionName = "manage-employees" }: {
  role: string | null | undefined;
  onChanged?: () => void | Promise<void>;
  functionName?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<EmployeeRole>("sales");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const load = useCallback(async () => {
    if (role !== "manager") return;
    setLoading(true); setError("");
    try {
      const { data, error: loadError } = await supabase.functions.invoke(functionName, { body: { action: "list" } });
      if (loadError) throw new Error(await functionError(loadError, "Employee accounts could not be loaded. Ask your system administrator to check the account-management connection."));
      if (!Array.isArray(data?.employees)) throw new Error(data?.error ?? "The employee list is unavailable. Please refresh it.");
      setEmployees(data.employees as EmployeeRecord[]); setLoaded(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load employee accounts."); }
    finally { setLoading(false); }
  }, [role, supabase, functionName]);

  useEffect(() => { if (role === "manager") void load(); else setEmployees([]); }, [role, load]);

  async function createEmployee(event: FormEvent) {
    event.preventDefault();
    if (busy || role !== "manager") return;
    if (!validEmployeePassword(password)) { setError("Use 12–72 characters with an uppercase letter, lowercase letter, number, and symbol, and no spaces at either end."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const { data, error: createError } = await supabase.functions.invoke(functionName, { body: { action: "create", display_name: name.trim(), email: email.trim(), role: newRole, password } });
      if (createError) throw new Error(await functionError(createError, "The employee account could not be created. Please retry."));
      if (!data?.employee?.id) throw new Error(data?.error ?? "Account creation could not be confirmed. Refresh the list before retrying.");
      const employee = data.employee as EmployeeRecord;
      setPassword(""); setShowPassword(false); setName(""); setEmail("");
      setMessage(`${employee.display_name} now has ${employee.role} access. Give them the temporary password you chose; they can change it after signing in.`);
      await load();
      if (onChanged) {
        try { await onChanged(); }
        catch { setError("The employee was created. Refresh the workspace to reload its other records."); }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Employee creation could not be confirmed."); }
    finally { setBusy(false); }
  }

  async function copyPassword() {
    if (!password) return;
    try { await navigator.clipboard.writeText(password); setMessage("Temporary password copied. Create the account, then share it directly with the employee."); }
    catch { setMessage("Your browser could not copy the password. Use Show, then copy it manually before creating the account."); }
  }

  if (role !== "manager") return <section className="panel"><h2>Employee accounts</h2><p className="muted">Only managers can view or create employee accounts.</p></section>;
  const filtered = employees.filter((employee) => (roleFilter === "all" || employee.role === roleFilter) && `${employee.display_name} ${employee.email}`.toLowerCase().includes(search.toLowerCase().trim()));
  return <>
    <div className="metric-grid">
      <article className="metric-card"><span>Employee accounts</span><strong>{loaded ? employees.length : "—"}</strong><small>Current employee profiles</small></article>
      <article className="metric-card"><span>Managers</span><strong>{loaded ? employees.filter((employee) => employee.role === "manager").length : "—"}</strong><small>Account creation access</small></article>
      <article className="metric-card"><span>Signed in before</span><strong>{loaded ? employees.filter((employee) => employee.last_sign_in_at).length : "—"}</strong><small>From account sign-in history</small></article>
      <article className="metric-card"><span>Shown</span><strong>{loaded ? filtered.length : "—"}</strong><small>Matches the filters below</small></article>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    <div className="split-grid">
      <section className="panel"><div className="panel-heading"><div><h2>Your team</h2><p>Employee logins and assigned roles, stored with your business accounts.</p></div><button className="secondary" disabled={loading || busy} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh"}</button></div>
        <div className="inline-form"><label>Search employees<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or email"/></label><label>Role<select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">All employee roles</option>{employeeRoles.map((value) => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</select></label></div>
        {loading && !employees.length ? <p role="status">Loading employees…</p> : <div className="table-scroll"><table><thead><tr><th>Employee</th><th>Email</th><th>Role</th><th>Last sign-in</th></tr></thead><tbody>{filtered.map((employee) => <tr key={employee.id}><td>{employee.display_name || "Employee"}</td><td>{employee.email}</td><td>{employee.role}</td><td>{employee.last_sign_in_at ? new Date(employee.last_sign_in_at).toLocaleString() : "Not signed in yet"}</td></tr>)}</tbody></table>{loaded && !filtered.length && <div className="empty-state">No employee accounts match these filters.</div>}{!loaded && !loading && <div className="empty-state">The employee list has not loaded. Refresh after the account-management connection is ready.</div>}</div>}
      </section>
      <form className="panel" onSubmit={createEmployee}><h2>Create an employee login</h2><p className="muted">Give the employee their temporary password directly. Their account is ready to use when creation succeeds.</p>
        <label>Full name<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" disabled={busy}/></label>
        <label>Email address<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" disabled={busy}/></label>
        <label>Role<select value={newRole} onChange={(event) => setNewRole(event.target.value as EmployeeRole)} disabled={busy}>{employeeRoles.map((value) => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</select></label><p className="footnote">{employeeRoleDescriptions[newRole]}</p>
        <label>Temporary password<input required type={showPassword ? "text" : "password"} minLength={12} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" disabled={busy}/></label>
        <div className="inline-form" style={{ flexWrap: "wrap", marginTop: ".75rem" }}><button type="button" className="secondary" disabled={busy} onClick={() => { setPassword(generateTemporaryPassword()); setShowPassword(true); setMessage("Copy the generated password before creating the account. The password field is cleared after success."); }}>Generate</button><button type="button" className="secondary" disabled={busy || !password} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button><button type="button" className="secondary" disabled={busy || !password} onClick={() => void copyPassword()}>Copy</button></div>
        <p className="footnote">Use 12–72 characters including uppercase, lowercase, a number, and a symbol.</p><button className="primary full" disabled={busy}>{busy ? "Creating employee…" : "Create employee account"}</button>
      </form>
    </div>
  </>;
}

export function EmployeePasswordChange() {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function change(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setError(""); setMessage("");
    if (!validEmployeePassword(password)) { setError("Use 12–72 characters including uppercase, lowercase, a number, and a symbol."); return; }
    if (password !== confirm) { setError("The new passwords do not match."); return; }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) { setError(updateError.message); return; }
      setPassword(""); setConfirm(""); setMessage("Your password has been changed.");
    } catch { setError("Your password could not be changed. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel-heading"><div><h2>Your password</h2><p>Replace your temporary password after your first sign-in.</p></div><button className="secondary" onClick={() => { setOpen(!open); setPassword(""); setConfirm(""); setError(""); setMessage(""); }}>{open ? "Close" : "Change password"}</button></div>{open && <form onSubmit={change}><div className="inline-form"><label>New password<input type="password" required minLength={12} maxLength={72} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy}/></label><label>Confirm new password<input type="password" required minLength={12} maxLength={72} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={busy}/></label><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save password"}</button></div>{error && <p className="notice" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}</form>}</section>;
}
