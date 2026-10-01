import { Mark } from "./Icon";
import { SYSTEM } from "@/lib/domain";

/** Two-panel card used by sign in, company sign up and password reset. */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="login">
      <div className="login-card">
        <div className="login-brand">
          <Mark />
          <div className="sys">{SYSTEM}</div>
          <p>Cargo management system</p>
          <ol className="stops">
            <li>Receive<small>Record goods and issue the receipt</small></li>
            <li>Load<small>Fill the truck against its target</small></li>
            <li>Dispatch<small>Notify every receiver on departure</small></li>
            <li>Deliver<small>Arrival notice, payment, collection</small></li>
          </ol>
          <div className="credit">Developed by <b>Serengeti Labs</b></div>
        </div>
        <div className="login-form">{children}</div>
      </div>
    </section>
  );
}
