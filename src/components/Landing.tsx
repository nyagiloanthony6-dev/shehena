"use client";
import { useActionState, useEffect, useState } from "react";
import { Icon, Mark } from "./Icon";
import { submitLead, type LeadState } from "@/app/lead-actions";

type Lang = "sw" | "en";
const T = {
  nav: { features: ["Huduma", "Features"], how: ["Inavyofanya kazi", "How it works"], pricing: ["Bei", "Pricing"], contact: ["Wasiliana", "Contact"], signin: ["Ingia", "Sign in"] },
  eyebrow: ["Mfumo wa mizigo kwa wasafirishaji wa mikoani", "Cargo software for Tanzania's regional transporters"],
  h1: ["Kila mzigo, kila gari, kila shilingi — mahali pamoja.", "Every parcel, every truck, every shilling — in one place."],
  lead: [
    "Pokea mizigo na utoe risiti, pakia magari kwa lengo la makusanyo, na wajulishe wateja kwa SMS na WhatsApp mzigo unapoondoka na unapofika. Wateja ambao hawajalipa wanaambiwa kiasi na jinsi ya kulipa kabla ya kuchukua.",
    "Receive goods and issue receipts, load trucks against a collection target, and tell customers by SMS and WhatsApp when their goods leave and arrive. Unpaid customers are told the amount and how to pay before they collect.",
  ],
  ctaDemo: ["Omba maonyesho", "Request a demo"],
  ctaSignin: ["Tayari una akaunti? Ingia", "Already a customer? Sign in"],
  strip: [["Mikoa yote 26 + Zanzibar", "All 26 regions + Zanzibar"], ["Ujumbe kwa Kiswahili na Kiingereza", "Messages in Kiswahili and English"], ["Simu, tablet au kompyuta", "Phone, tablet or computer"]],
  featH: ["Kila hatua ya mzigo, bila daftari", "Every step of a consignment, without the ledger book"],
  feats: [
    ["box", ["Pokea na utoe risiti", "Receive and issue receipts"], ["Mtumaji, mpokeaji, mzigo, vifurushi na malipo. Risiti ya PDF na namba ya mzigo papo hapo. Mteja aliyewahi kuja anajazwa jina mwenyewe.", "Sender, receiver, item, packages and payment. A PDF receipt and waybill number in seconds. Returning customers fill in by phone number."]],
    ["trips", ["Pakia kwa lengo la makusanyo", "Load trucks against a target"], ["Kila gari lina lengo la TZS kwa safari. Unaona makusanyo, vifurushi na wateja wakati unapakia, na gari linapofikia lengo.", "Each truck has a TZS target per trip. See collections, packages and customers as you load, and when the truck reaches its target."]],
    ["arrivals", ["Mapokezi na kutoa mzigo", "Arrivals and release"], ["Gari likifika, wateja wanaarifiwa. Mzigo haujatolewa mpaka malipo yamerekodiwa — mfumo wenyewe unazuia.", "When a truck arrives, customers are notified. Goods can't be released until payment is recorded — the system enforces it."]],
    ["new", ["SMS na WhatsApp kwa wateja", "SMS and WhatsApp to customers"], ["Mzigo umepokelewa, umeondoka, umefika, na vikumbusho vya malipo — kwa Kiswahili au Kiingereza, kwa jina la kampuni yako.", "Received, departed, arrived and payment reminders — in Kiswahili or English, under your company's name."]],
    ["reports", ["Ripoti kwa Mkurugenzi", "Reports for the CEO"], ["Makusanyo kwa mwezi na mwaka, kwa gari, kwa safari, yaliyolipwa na yasiyolipwa. Mkurugenzi anaona yote bila kuuliza.", "Collections by month and year, by truck, by trip, paid and unpaid. The CEO sees everything without asking."]],
    ["set", ["Kila mtu na kazi yake", "Everyone with their own login"], ["Admin, Keshia na Mkurugenzi kila mmoja na barua pepe na nenosiri lake. Keshia hawezi kufuta rekodi wala kubadilisha malengo.", "Admin, Cashier and CEO each sign in with their own email and password. Cashiers can't delete records or change targets."]],
  ] as [string, string[], string[]][],
  howH: ["Inavyofanya kazi", "How it works"],
  steps: [
    [["Pokea", "Receive"], ["Mteja analeta mzigo. Unaurekodi, unatoa risiti, na mpokeaji anapata ujumbe.", "A customer brings goods. You record them, print a receipt, and the receiver gets a message."]],
    [["Pakia", "Load"], ["Unapakia mizigo kwenye gari na kuona makusanyo dhidi ya lengo.", "Load consignments onto a truck and watch collections against its target."]],
    [["Safirisha", "Dispatch"], ["Gari likiondoka, kila mpokeaji anaambiwa mzigo uko njiani na namba ya gari.", "When the truck leaves, every receiver is told their goods are on the way, with the plate number."]],
    [["Fikisha", "Deliver"], ["Gari likifika, wateja wanaarifiwa, wanalipa, na mzigo unatolewa.", "When it arrives, customers are notified, they pay, and the goods are released."]],
  ] as string[][][],
  priceH: ["Bei rahisi, kulingana na kampuni yako", "Simple pricing that fits your company"],
  priceP: [
    "Unalipa ada ya mwezi kulingana na idadi ya magari na matawi yako. SMS na WhatsApp zinalipwa kwa vifurushi. Anza na kipindi cha majaribio — tutakuwekea mfumo na kuwafundisha wafanyakazi wako.",
    "A monthly fee based on how many trucks and branches you run. SMS and WhatsApp are paid in bundles. Start with a trial period — we set you up and train your staff.",
  ],
  priceList: [["Majaribio ya bure kabla ya kulipa", "Free trial before you pay"], ["Mafunzo kwa wafanyakazi", "Staff training included"], ["Taarifa zako ni zako — zinatenganishwa na kampuni nyingine", "Your data is yours — kept separate from every other company"], ["Msaada kwa simu na WhatsApp", "Support by phone and WhatsApp"]],
  faqH: ["Maswali yanayoulizwa", "Questions"],
  faqs: [
    [["Ninahitaji kununua kompyuta?", "Do I need to buy a computer?"], ["Hapana. Shehena inafanya kazi kwenye simu yoyote yenye intaneti, tablet au kompyuta.", "No. Shehena works on any smartphone with internet, a tablet or a computer."]],
    [["Kampuni nyingine zinaweza kuona taarifa zangu?", "Can other companies see my data?"], ["Hapana. Kila kampuni ina eneo lake lililofungwa. Hata wafanyakazi wako wanaona tu kile nafasi yao inaruhusu.", "No. Every company has its own locked space. Even your own staff only see what their role allows."]],
    [["Risiti na ujumbe zinaonyesha jina la kampuni yangu?", "Do receipts and messages show my company name?"], ["Ndiyo. Jina, tawi na simu ya kampuni yako vinaonekana kwenye risiti na kila ujumbe kwa mteja.", "Yes. Your company name, branch and phone appear on receipts and every customer message."]],
    [["Nikiwa na matawi zaidi ya moja?", "What if I have more than one branch?"], ["Wafanyakazi wa Dar na wa mkoani wanatumia mfumo mmoja: mmoja anapakia, mwingine anapokea gari likifika.", "Staff in Dar and upcountry use the same system: one loads the truck, another receives it on arrival."]],
  ] as string[][][],
  formH: ["Omba maonyesho ya bure", "Request a free demo"],
  formP: ["Acha mawasiliano yako, tutakupigia ndani ya siku moja ya kazi.", "Leave your details and we'll call you within one working day."],
  f: { name: ["Jina lako", "Your name"], company: ["Jina la kampuni", "Company name"], phone: ["Namba ya simu", "Phone number"], email: ["Barua pepe (si lazima)", "Email (optional)"], region: ["Mkoa mkuu wa kazi", "Main region"], trucks: ["Idadi ya magari", "Number of trucks"], message: ["Ujumbe (si lazima)", "Message (optional)"], send: ["Tuma ombi", "Send request"], sending: ["Inatuma…", "Sending…"] },
  ok: ["Asante! Tumepokea ombi lako. Tutakupigia hivi karibuni.", "Thank you! We've received your request and will call you soon."],
  errMissing: ["Tafadhali jaza jina na namba ya simu.", "Please enter your name and phone number."],
  errServer: ["Imeshindikana kutuma. Jaribu tena au tupigie.", "Couldn't send. Please try again or call us."],
  wa: ["Tuandikie WhatsApp", "Message us on WhatsApp"],
  foot: ["Mfumo wa kusimamia mizigo ya usafirishaji wa mikoani.", "Cargo management for regional road transport."],
};
const L = (pair: string[], lang: Lang) => pair[lang === "sw" ? 0 : 1];

export default function Landing() {
  const [lang, setLang] = useState<Lang>("sw");
  const [source, setSource] = useState("");
  const [state, action, pending] = useActionState<LeadState, FormData>(submitLead, {});
  const wa = (process.env.NEXT_PUBLIC_SALES_WHATSAPP || "").replace(/\D/g, "");

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const ref = sp.get("ref") || sp.get("utm_source") || "";
      if (ref) { setSource(ref); sessionStorage.setItem("shehena.ref", ref); } else setSource(sessionStorage.getItem("shehena.ref") || "");
      const saved = localStorage.getItem("shehena.lang");
      if (saved === "en" || saved === "sw") setLang(saved);
    } catch { /* storage blocked */ }
  }, []);
  const pick = (l: Lang) => { setLang(l); try { localStorage.setItem("shehena.lang", l); } catch { /* ignore */ } };

  return (
    <div className="mk" lang={lang}>
      <header className="mk-nav">
        <a className="brandrow" href="#top" style={{ textDecoration: "none", color: "inherit" }}><Mark /><span className="mk-word">Shehena</span></a>
        <nav className="mk-links" aria-label="Sections">
          <a href="#features">{L(T.nav.features, lang)}</a><a href="#how">{L(T.nav.how, lang)}</a><a href="#pricing">{L(T.nav.pricing, lang)}</a><a href="#demo">{L(T.nav.contact, lang)}</a>
        </nav>
        <div className="mk-right">
          <div className="mk-lang" role="group" aria-label="Language">
            <button aria-pressed={lang === "sw"} onClick={() => pick("sw")}>SW</button><button aria-pressed={lang === "en"} onClick={() => pick("en")}>EN</button>
          </div>
          <a className="btn sm" href="/login">{L(T.nav.signin, lang)}</a>
        </div>
      </header>

      <section className="mk-hero" id="top">
        <div className="mk-hero-in">
          <div className="mk-copy">
            <div className="mk-eyebrow">{L(T.eyebrow, lang)}</div>
            <h1>{L(T.h1, lang)}</h1>
            <p>{L(T.lead, lang)}</p>
            <div className="actions" style={{ marginTop: 22 }}>
              <a className="btn lg mk-cta" href="#demo">{L(T.ctaDemo, lang)}</a>
              <a className="mk-textlink" href="/login">{L(T.ctaSignin, lang)} →</a>
            </div>
          </div>
          <div className="mk-visual" aria-hidden="true">
            <div className="mk-card mk-slip">
              <div className="lbl">Risiti · DAR-DOD-261009-4172</div>
              <div className="mk-slip-row"><span>Mpokeaji</span><b>Asha Mwakyusa</b></div>
              <div className="mk-slip-row"><span>Mzigo</span><b>Solar panels · 3</b></div>
              <div className="mk-slip-row"><span>Njia</span><b>Dar es Salaam → Dodoma</b></div>
              <div className="mk-slip-row"><span>Kiasi</span><b className="mono">TZS 60,000</b></div>
            </div>
            <div className="mk-card mk-truck">
              <div className="top"><span className="plate">T 915 CBA</span><span className="pill st-departed">Njiani</span></div>
              <div className="meterlbl"><span>TZS <b>2,180,000</b> / 2,500,000</span><span>87%</span></div>
              <div className="meter"><span style={{ width: "87%" }} /></div>
            </div>
            <div className="mk-bubble">
              <div className="mk-bubble-h">WhatsApp · SMS</div>
              Habari Asha, mzigo wako DAR-DOD-…4172 umefika Dodoma kwa gari T 915 CBA. Kiasi cha kulipa ni TZS 60,000. Lipa kupitia Lipa Namba 123456, kisha fika ofisini kuuchukua.
            </div>
          </div>
        </div>
        <ul className="mk-strip">{T.strip.map((s, i) => <li key={i}>{L(s, lang)}</li>)}</ul>
      </section>

      <section className="mk-sec" id="features">
        <h2>{L(T.featH, lang)}</h2>
        <div className="mk-grid">
          {T.feats.map(([icon, h, p]) => (
            <div className="mk-feat" key={icon}><span className="mk-ico"><Icon name={icon} /></span><h3>{L(h, lang)}</h3><p>{L(p, lang)}</p></div>
          ))}
        </div>
      </section>

      <section className="mk-sec mk-how" id="how">
        <h2>{L(T.howH, lang)}</h2>
        <ol className="mk-steps">
          {T.steps.map(([h, p], i) => <li key={i}><b>{L(h, lang)}</b><span>{L(p, lang)}</span></li>)}
        </ol>
      </section>

      <section className="mk-sec mk-two" id="pricing">
        <div>
          <h2>{L(T.priceH, lang)}</h2>
          <p className="mk-p">{L(T.priceP, lang)}</p>
          <ul className="mk-checks">{T.priceList.map((x, i) => <li key={i}>{L(x, lang)}</li>)}</ul>
        </div>
        <div>
          <h2 style={{ fontSize: 22 }}>{L(T.faqH, lang)}</h2>
          {T.faqs.map(([q, a], i) => <details className="mk-faq" key={i}><summary>{L(q, lang)}</summary><p>{L(a, lang)}</p></details>)}
        </div>
      </section>

      <section className="mk-sec mk-demo" id="demo">
        <div className="mk-demo-in">
          <div>
            <h2>{L(T.formH, lang)}</h2>
            <p className="mk-p">{L(T.formP, lang)}</p>
            {wa && <a className="btn wa" style={{ marginTop: 10 }} href={`https://wa.me/${wa}?text=${encodeURIComponent(lang === "sw" ? "Habari, ningependa kujua zaidi kuhusu Shehena." : "Hello, I'd like to know more about Shehena.")}`} target="_blank" rel="noopener noreferrer">{L(T.wa, lang)}</a>}
          </div>
          {state.ok ? (
            <div className="mk-ok" role="status">{L(T.ok, lang)}</div>
          ) : (
            <form action={action} className="mk-form">
              <input type="hidden" name="source" value={source} />
              <input name="website" tabIndex={-1} autoComplete="off" className="mk-hp" aria-hidden="true" />
              <div className="fields">
                <label className="f">{L(T.f.name, lang)}<input name="name" required autoComplete="name" /></label>
                <label className="f">{L(T.f.phone, lang)}<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" /></label>
                <label className="f">{L(T.f.company, lang)}<input name="company" autoComplete="organization" /></label>
                <label className="f">{L(T.f.email, lang)}<input name="email" type="email" autoComplete="email" /></label>
                <label className="f">{L(T.f.region, lang)}<input name="region" placeholder="Dar es Salaam" /></label>
                <label className="f">{L(T.f.trucks, lang)}<select name="trucks" defaultValue=""><option value="" disabled>—</option><option>1–2</option><option>3–5</option><option>6–10</option><option>11–20</option><option>20+</option></select></label>
                <label className="f full">{L(T.f.message, lang)}<textarea name="message" rows={3} /></label>
              </div>
              {state.error && <div className="auth-err" role="alert">{state.error === "missing" ? L(T.errMissing, lang) : L(T.errServer, lang)}</div>}
              <button className="btn primary lg" type="submit" disabled={pending} style={{ width: "100%", marginTop: 6 }}>{pending ? L(T.f.sending, lang) : L(T.f.send, lang)}</button>
            </form>
          )}
        </div>
      </section>

      <footer className="mk-foot">
        <div className="brandrow"><Mark /><div><b>Shehena</b><div className="sub">{L(T.foot, lang)}</div></div></div>
        <div className="sub">© {new Date().getFullYear()} · Developed by <b>Serengeti Labs</b> · Dar es Salaam</div>
      </footer>
    </div>
  );
}
