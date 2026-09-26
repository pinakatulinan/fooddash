import type { Metadata } from "next";
import { LegalPage, LegalSection, LegalList } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

const UPDATED = "September 23, 2026";
const LEGAL_ENTITY = "FoodDash (operating name — registered business entity to be added)";
const CONTACT_EMAIL = "privacy@fooddash.test";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated={UPDATED}>
      <p className="text-[15px] leading-relaxed text-fg-muted">
        This Privacy Policy explains what personal data {LEGAL_ENTITY} collects through the FoodDash app and
        website (the &ldquo;Service&rdquo;), why, and what rights you have over it. It is written to comply with
        the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).
      </p>

      <LegalSection heading="1. What we collect">
        <p>What&apos;s collected depends on how you use the Service:</p>
        <LegalList>
          <li>
            <strong>Every account:</strong> name, email address, phone number, and password (stored hashed, never
            in plain text).
          </li>
          <li>
            <strong>Customers:</strong> delivery addresses and their GPS coordinates, order history, and payment
            method selection. Card, GCash, and Maya details themselves are handled directly by PayMongo, our
            payment processor — we never see or store your full card or wallet credentials.
          </li>
          <li>
            <strong>Riders:</strong> date of birth, home address, an emergency contact, a payout account (GCash,
            Maya, or bank — encrypted at rest and never displayed in full to anyone but you and FoodDash
            operations staff reviewing a payout issue), and verification documents — a government ID, selfie,
            and for motorized vehicles a driver&apos;s license and vehicle registration (OR/CR). While online and
            available for deliveries, we collect your live GPS location to route jobs to you.
          </li>
          <li>
            <strong>Merchants:</strong> business name and address, a business permit, BIR registration, and
            sanitary permit, and a payout account (encrypted at rest the same way a rider&apos;s is).
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="2. Why we collect it">
        <LegalList>
          <li>To create and secure your account, and to let you sign back in.</li>
          <li>To take, prepare, dispatch, and deliver an order — this is the core reason most data here exists.</li>
          <li>
            To verify that a rider or merchant meets our safety and legal requirements before they can accept
            orders or be listed.
          </li>
          <li>To process payments through PayMongo, and to detect and prevent fraud.</li>
          <li>To provide customer support and investigate a reported problem with an order.</li>
          <li>To meet legal and tax obligations.</li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="3. Live location">
        <p>
          A rider&apos;s location updates roughly every 10 seconds while they are online. This is used
          internally to find the nearest available rider for a new order. Once a rider accepts your delivery,
          your order tracking page shows their live position, first name, vehicle, and plate number — never
          their full profile, phone number by default, or location outside of an active delivery to you.
        </p>
      </LegalSection>

      <LegalSection heading="4. Who we share data with">
        <LegalList>
          <li>
            <strong>The other side of your order</strong> — a customer sees the assigned rider&apos;s first name,
            vehicle, and live location during delivery; a merchant sees the customer&apos;s delivery address and
            order contents; a rider sees the pickup and drop-off addresses for a job they accept.
          </li>
          <li>
            <strong>PayMongo</strong>, for processing online payments — governed by PayMongo&apos;s own privacy
            policy for the payment details you give them directly.
          </li>
          <li>
            <strong>Service providers</strong> that host and run the Service on our behalf (database and file
            storage hosting), bound to only use your data to provide that service to us.
          </li>
          <li>
            <strong>Law enforcement or regulators</strong>, only where required by Philippine law or a valid
            legal process.
          </li>
        </LegalList>
        <p>We do not sell personal data to third parties.</p>
      </LegalSection>

      <LegalSection heading="5. How we protect it">
        <LegalList>
          <li>Payout account numbers are encrypted at rest and are never readable in plain text from a database backup or casual query — only through a controlled function restricted to the account owner or an administrator.</li>
          <li>Verification documents (IDs, permits) are stored in a private file store; only the uploader and FoodDash administrators can access them, and only via short-lived, single-use links.</li>
          <li>Database access is restricted row-by-row so that, for example, one rider cannot read another rider&apos;s data even if a request were crafted to try.</li>
          <li>Passwords are never stored in a form we could read back — only a one-way hash.</li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="6. How long we keep it">
        <p>
          We keep account and order data for as long as your account is active, and for a reasonable period
          afterward to meet tax, accounting, and dispute-resolution obligations. Rider and merchant verification
          documents are kept for as long as needed to demonstrate that a rider or merchant was properly vetted
          while active on the Service, and are deleted or anonymized on a schedule after an account is closed,
          except where a longer retention period is legally required.
        </p>
      </LegalSection>

      <LegalSection heading="7. Your rights">
        <p>Under the Data Privacy Act, you have the right to:</p>
        <LegalList>
          <li>Be informed that your data is being processed, and how (this policy).</li>
          <li>Access the personal data we hold about you.</li>
          <li>Correct inaccurate data.</li>
          <li>Object to processing, or withdraw consent where processing is based on it.</li>
          <li>Request erasure or blocking of your data, subject to legal retention requirements.</li>
          <li>Receive a copy of your data in a portable format.</li>
          <li>File a complaint with the National Privacy Commission (NPC) if you believe your rights were violated.</li>
        </LegalList>
        <p>
          To exercise any of these, contact us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-primary">
            {CONTACT_EMAIL}
          </a>
          . We may need to verify your identity before acting on a request.
        </p>
      </LegalSection>

      <LegalSection heading="8. Children">
        <p>The Service is not directed at anyone under 18, and rider applicants are specifically verified to be at least 18. We do not knowingly collect personal data from children.</p>
      </LegalSection>

      <LegalSection heading="9. Changes to this policy">
        <p>We may update this policy from time to time. We will post the updated version here with a new &ldquo;Last updated&rdquo; date, and will highlight material changes in the app where practical.</p>
      </LegalSection>

      <LegalSection heading="10. Contact us">
        <p>
          For any question about this policy or how your data is handled, contact{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-primary">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
