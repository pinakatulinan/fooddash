import type { Metadata } from "next";
import { LegalPage, LegalSection, LegalList } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

const UPDATED = "September 23, 2026";

/**
 * Placeholder legal entity: FoodDash does not yet have a registered
 * business behind it (see the PayMongo KYB conversation this policy was
 * written after - no DTI/SEC registration exists yet). Fill in the real
 * registered name, address and contact once one does; everything else here
 * describes what the app actually does today, not aspirational features.
 */
const LEGAL_ENTITY = "FoodDash (operating name — registered business entity to be added)";
const CONTACT_EMAIL = "support@fooddash.test";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated={UPDATED}>
      <p className="text-[15px] leading-relaxed text-fg-muted">
        These Terms govern your use of the FoodDash app and website (the &ldquo;Service&rdquo;), operated by{" "}
        {LEGAL_ENTITY}. By creating an account or placing an order, you agree to these Terms. If you do not
        agree, do not use the Service.
      </p>

      <LegalSection heading="1. Who can use FoodDash">
        <p>
          You must be at least 18 years old to create an account, place orders, or register as a merchant or
          rider. Rider applicants are additionally verified against this minimum age as part of onboarding. By
          using the Service you confirm the information you provide is accurate and that you have the legal
          capacity to enter into these Terms.
        </p>
      </LegalSection>

      <LegalSection heading="2. Accounts">
        <p>
          You are responsible for keeping your password and any two-factor authentication method secure, and
          for all activity under your account. Tell us immediately if you suspect unauthorized access. We may
          suspend or terminate an account that provides false information, violates these Terms, or is used
          fraudulently.
        </p>
      </LegalSection>

      <LegalSection heading="3. Placing and fulfilling orders">
        <p>
          When you place an order, you are making an offer to purchase food from an independent merchant listed
          on FoodDash at the displayed price, plus delivery and service fees shown before checkout. A merchant
          may decline an order (for example if an item just sold out); if that happens, any payment already
          captured is refunded or the order is not charged.
        </p>
        <p>
          Delivery times shown are estimates, not guarantees. They depend on the merchant&apos;s preparation
          time, rider availability, traffic, and weather.
        </p>
      </LegalSection>

      <LegalSection heading="4. Payment">
        <p>Orders may be paid in one of two ways:</p>
        <LegalList>
          <li>
            <strong>Cash on delivery</strong> — paid directly to the rider on handover.
          </li>
          <li>
            <strong>Online payment</strong> (GCash, Maya, or card) — processed by PayMongo, a licensed third-party
            payment processor. FoodDash does not receive or store your full card number, GCash, or Maya
            credentials; PayMongo handles that directly.
          </li>
        </LegalList>
        <p>
          Prices are in Philippine Pesos (PHP) and include the delivery fee and any applicable service fee shown
          at checkout. Promo codes are subject to their own stated conditions and may be withdrawn or changed at
          any time.
        </p>
      </LegalSection>

      <LegalSection heading="5. Cancellations and refunds">
        <p>
          You can cancel an order for free any time before the merchant accepts it. Once a merchant has started
          preparing your order, cancellation may no longer be possible, and a partial or full charge may apply
          depending on how much preparation has already happened.
        </p>
        <p>
          If an order cannot be completed for a reason on FoodDash&apos;s, the merchant&apos;s, or the
          rider&apos;s side (a rider incident, a closed store, a missing item), we will refund the affected
          amount to your original online payment method, or, for cash orders, no payment is collected.
        </p>
      </LegalSection>

      <LegalSection heading="6. Merchants">
        <p>
          Merchants listed on FoodDash are independent businesses, not FoodDash employees or agents. Each
          merchant is responsible for the quality, safety, accuracy, and legal compliance (including food
          safety permits) of the items they list. Merchant accounts are subject to a review process, including
          submission of a business permit, BIR registration, and sanitary permit, before being listed publicly,
          and may be suspended if that documentation lapses or a serious issue is reported.
        </p>
      </LegalSection>

      <LegalSection heading="7. Riders">
        <p>
          Riders are independent contractors, not FoodDash employees. Rider applicants must pass identity and
          document verification (a valid ID, and for motorized vehicles a driver&apos;s license and OR/CR)
          before being allowed to accept deliveries. While online and available for deliveries, a rider&apos;s
          approximate live location is shared with FoodDash to enable dispatch, and with the specific customer
          they are delivering to for the duration of that one delivery only.
        </p>
        <p>
          Riders are expected to follow traffic laws and handle food and cash responsibly. FoodDash may suspend
          a rider account in response to safety complaints, repeated cancellations, or expired documentation.
        </p>
      </LegalSection>

      <LegalSection heading="8. Ratings and reviews">
        <p>
          Customers may rate a completed order and leave a comment. Reviews must be truthful and based on an
          actual order. We may remove a review that is abusive, off-topic, or violates these Terms.
        </p>
      </LegalSection>

      <LegalSection heading="9. Prohibited conduct">
        <p>You agree not to:</p>
        <LegalList>
          <li>Use the Service for anything unlawful, fraudulent, or harmful to another user.</li>
          <li>Attempt to access another user&apos;s account or data without authorization.</li>
          <li>Interfere with, probe, or disrupt the Service&apos;s infrastructure or security.</li>
          <li>Create an account for someone else without their permission, or misrepresent your identity.</li>
          <li>Abuse promo codes, referral programs, or the refund/cancellation process.</li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="10. Limitation of liability">
        <p>
          FoodDash connects customers, merchants, and riders; it does not prepare food or make deliveries
          itself. To the maximum extent permitted by Philippine law, FoodDash is not liable for the quality,
          safety, or legality of items sold by merchants, or for the acts or omissions of independent riders or
          merchants, beyond facilitating a refund or account action where these Terms provide for one.
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes to these Terms">
        <p>
          We may update these Terms from time to time. Continuing to use the Service after a change is posted
          means you accept the updated Terms. Material changes will be highlighted in the app where practical.
        </p>
      </LegalSection>

      <LegalSection heading="12. Governing law">
        <p>
          These Terms are governed by the laws of the Republic of the Philippines. Any dispute arising from
          these Terms or your use of the Service will be subject to the exclusive jurisdiction of the
          appropriate courts of the Philippines.
        </p>
      </LegalSection>

      <LegalSection heading="13. Contact">
        <p>
          Questions about these Terms can be sent to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-primary">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
