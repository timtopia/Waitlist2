import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for Waitlyst - digital queue management and position swapping platform.",
}

export default function TermsOfServicePage() {
  return (
    <div className="bg-white py-12 sm:py-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-gray-500 mb-10">
          Last updated: April 15, 2026
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-10">
          <p className="text-sm text-amber-800">
            <strong>Note:</strong> This is a template Terms of Service document
            and does not constitute legal advice. You should consult a qualified
            attorney to ensure your terms meet all applicable legal requirements.
          </p>
        </div>

        {/* 1. Acceptance of Terms */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            1. Acceptance of Terms
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            By accessing or using Waitlyst (&ldquo;the Service&rdquo;), you agree to be
            bound by these Terms of Service. If you do not agree to these terms,
            do not use the Service.
          </p>
          <p className="text-gray-700 leading-relaxed">
            You must be at least 18 years old to use Waitlyst. By using the
            Service, you represent that you are at least 18 years of age.
          </p>
        </section>

        {/* 2. Description of Service */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            2. Description of Service
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            Waitlyst is a digital queue management platform. Creators can set up
            virtual lines for product drops, events, and other purposes. Users
            can join these lines to reserve a position.
          </p>
          <p className="text-gray-700 leading-relaxed">
            Waitlyst also offers position swapping, which allows users to pay a
            fee to swap positions with the person directly ahead of them in line.
            Position swapping is optional and configured by the line creator.
          </p>
        </section>

        {/* 3. User Accounts */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            3. User Accounts
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            Waitlyst uses Google OAuth for authentication. When you sign in, we
            receive your name, email address, and profile picture from Google.
            You do not create a separate username or password with us.
          </p>
          <p className="text-gray-700 leading-relaxed mb-3">
            You are responsible for maintaining the security of your Google
            account that is linked to Waitlyst. Any activity that occurs through
            your account is your responsibility.
          </p>
          <p className="text-gray-700 leading-relaxed">
            We reserve the right to suspend or terminate accounts that violate
            these terms or engage in prohibited conduct.
          </p>
        </section>

        {/* 4. Position Swapping */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            4. Position Swapping
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            When you initiate a position swap, you agree to pay the listed swap
            price. <strong>All swaps are final.</strong> Once a swap is
            completed, it cannot be reversed or refunded.
          </p>
          <p className="text-gray-700 leading-relaxed mb-3">
            Waitlyst uses an authorize-then-capture payment model. When you
            request a swap, your payment method is authorized for the swap
            amount. The charge is only captured once the swap is confirmed and
            completed.
          </p>
          <p className="text-gray-700 leading-relaxed">
            Payouts to the person who gave up their position are conditional on
            fulfillment. This means the line creator must confirm that service
            has been delivered before payouts are released.
          </p>
        </section>

        {/* 5. Fees */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            5. Fees
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            Each position swap may involve the following fees:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 mb-3">
            <li>
              <strong>Platform fee:</strong> Waitlyst charges a percentage-based
              service fee on each swap transaction.
            </li>
            <li>
              <strong>Owner fee:</strong> The line creator may set an additional
              fee that they earn from each swap within their line.
            </li>
            <li>
              <strong>Stripe processing fee:</strong> Standard payment processing
              fees are applied by Stripe to each transaction.
            </li>
          </ul>
          <p className="text-gray-700 leading-relaxed">
            The total cost of a swap, including all applicable fees, is displayed
            before you confirm the transaction. Joining a line is free.
          </p>
        </section>

        {/* 6. Creator Responsibilities */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            6. Creator Responsibilities
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            If you create a line on Waitlyst, you are responsible for:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 mb-3">
            <li>
              Accurately describing the purpose of your line (e.g., the product,
              event, or service being offered).
            </li>
            <li>
              Managing your line in good faith, including calling the next person
              and fulfilling the service or product.
            </li>
            <li>
              Complying with all applicable laws and regulations related to your
              event or offering.
            </li>
          </ul>
          <p className="text-gray-700 leading-relaxed">
            Creators who receive payouts through Stripe Connect must provide
            accurate identity and banking information to Stripe. Waitlyst is not
            responsible for delays in payouts caused by incomplete Stripe
            onboarding.
          </p>
        </section>

        {/* 7. Prohibited Conduct */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            7. Prohibited Conduct
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            You agree not to:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2">
            <li>
              Use bots, scripts, or automated tools to join lines, initiate
              swaps, or manipulate positions.
            </li>
            <li>
              Create fake accounts or use multiple accounts to gain an unfair
              advantage.
            </li>
            <li>
              Engage in fraud, including using stolen payment methods or
              initiating chargebacks for completed swaps.
            </li>
            <li>
              Manipulate the queue system or exploit bugs for personal gain.
            </li>
            <li>
              Harass, threaten, or abuse other users or line creators.
            </li>
            <li>
              Create lines for illegal activities or prohibited goods.
            </li>
          </ul>
        </section>

        {/* 8. Limitation of Liability */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            8. Limitation of Liability
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            Waitlyst is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of
            any kind, whether express or implied. We do not guarantee that the
            Service will be uninterrupted, error-free, or secure.
          </p>
          <p className="text-gray-700 leading-relaxed mb-3">
            Waitlyst is a platform that connects line creators with users. We are
            not responsible for the actions of line creators, including their
            failure to deliver promised goods or services.
          </p>
          <p className="text-gray-700 leading-relaxed">
            To the maximum extent permitted by law, Waitlyst and its operators
            shall not be liable for any indirect, incidental, special,
            consequential, or punitive damages arising from your use of the
            Service.
          </p>
        </section>

        {/* 9. Modifications to Terms */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            9. Modifications to Terms
          </h2>
          <p className="text-gray-700 leading-relaxed">
            We may update these Terms of Service from time to time. When we make
            changes, we will update the &ldquo;Last updated&rdquo; date at the top of this
            page. Your continued use of Waitlyst after changes are posted
            constitutes your acceptance of the updated terms. We encourage you to
            review these terms periodically.
          </p>
        </section>

        {/* 10. Contact Information */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            10. Contact Information
          </h2>
          <p className="text-gray-700 leading-relaxed">
            If you have questions about these Terms of Service, please contact us
            at{" "}
            <a
              href="mailto:support@waitlyst.app"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              support@waitlyst.app
            </a>
            .
          </p>
        </section>

        {/* Back to Home */}
        <div className="pt-6 border-t border-gray-200">
          <Link
            href="/"
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
