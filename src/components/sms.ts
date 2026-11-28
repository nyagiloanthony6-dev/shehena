"use client";
import { autoSms } from "@/app/app/sms-actions";
import type { NoticeKind } from "@/lib/domain";

/** After an event: send the automatic SMS the company switched on, in the background. Never blocks the work. */
export function smsAfter(ids: string[], kind: NoticeKind, toast: (m: string, e?: boolean) => void) {
  if (!ids.length) return;
  void autoSms(ids, kind).then((r) => {
    if (r.notConfigured) toast("SMS not sent: SMS isn't connected for your company yet. Contact Serengeti Labs.", true);
    else if (r.noCredit) toast(`${r.noCredit} SMS not sent: no SMS left. Buy an SMS bundle from Serengeti Labs.`, true);
    else if (r.failed) toast(`${r.failed} SMS could not be sent. Nothing was charged for ${r.failed === 1 ? "it" : "them"}.`, true);
    else if (r.sent) toast(`📩 ${r.sent} SMS sent automatically.`);
    else if (r.noPhone) toast("No SMS sent: no valid phone number on this consignment.", true);
  }).catch(() => {});
}
