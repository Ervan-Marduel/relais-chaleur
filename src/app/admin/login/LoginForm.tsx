"use client";
import { useActionState } from "react";
import { loginAction } from "../actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null as null | { error?: string });
  return (
    <form action={action}>
      {state?.error && <div className="notice danger flash" role="alert"><p>{state.error}</p></div>}
      <label className="field"><span className="label">Email</span><input type="email" name="email" autoComplete="username" required /></label>
      <label className="field"><span className="label">Mot de passe</span><input type="password" name="password" autoComplete="current-password" required /></label>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Connexion…" : "Se connecter"}</button>
    </form>
  );
}
