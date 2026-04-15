import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Waitlyst - how we collect, use, and protect your information.",
}

export default function PrivacyPolicyPage() {
  return (
    <div className="bg-white py-12 sm:py-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-500 mb-10">
          Last updated: April 15, 2026
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-10">
          <p className="text-sm text-amber-800">
            <strong>Note:</strong> This is a template Privacy Policy document and
            does not constitute legal advice. You should consult a qualified
            attorney to ensure your privacy practices meet all applicable legal
            requirements.
          </p>
        </div>

        {/* 1. Information We Collect */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            1. Information We Collect
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            We collect the following types of information when you use Waitlyst:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2">
            <li>
              <strong>Account information:</strong> When you sign in with Google
              OAuth, we receive your name, email address, and profile picture
              from Google.
            </li>
            <li>
              <strong>Transaction data:</strong> When you participate in position
              swaps, we record transaction details including amounts, timestamps,
              and the parties involved.
            </li>
            <li>
              <strong>Usage data:</strong> We collect information about how you
              interact with the Service, including the lines you join, your
              positions, and swap activity.
            </li>
          </ul>
        </section>

        {/* 2. How We Use Information */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            2. How We Use Information
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            We use the information we collect to:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2">
            <li>
              <strong>Manage your account:</strong> Identify you across sessions,
              display your name and profile picture in lines.
            </li>
            <li>
              <strong>Process transactions:</strong> Facilitate position swaps,
              process payments through Stripe, and distribute payouts to
              eligible users.
            </li>
            <li>
              <strong>Send notifications:</strong> Inform you about position
              changes, swap completions, and line updates.
            </li>
            <li>
              <strong>Improve the Service:</strong> Understand how users interact
              with Waitlyst so we can make it better.
            </li>
          </ul>
        </section>

        {/* 3. Stripe Connect */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            3. Stripe Connect
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            Waitlyst uses Stripe Connect to process payments and distribute
            payouts to line creators and users who earn from position swaps. If
            you choose to receive payouts, you will be asked to create a Stripe
            Connect account.
          </p>
          <p className="text-gray-700 leading-relaxed mb-3">
            As part of Stripe&apos;s onboarding process, Stripe may collect additional
            information from you, including your legal name, date of birth,
            address, and banking details. This information is collected and
            managed by Stripe, not by Waitlyst.
          </p>
          <p className="text-gray-700 leading-relaxed">
            Stripe&apos;s collection and use of your information is governed by{" "}
            <a
              href="https://stripe.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              Stripe&apos;s Privacy Policy
            </a>
            . We encourage you to review it before creating a Stripe Connect
            account.
          </p>
        </section>

        {/* 4. Data Sharing */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            4. Data Sharing
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            We do not sell your personal information to third parties.
          </p>
          <p className="text-gray-700 leading-relaxed mb-3">
            We share your information only in the following circumstances:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2">
            <li>
              <strong>With Stripe:</strong> We share transaction-related
              information with Stripe to process payments and payouts.
            </li>
            <li>
              <strong>With other users:</strong> Your name and profile picture
              are visible to other participants in lines you join. Line creators
              can see the names and positions of users in their lines.
            </li>
            <li>
              <strong>As required by law:</strong> We may disclose information if
              required by law, regulation, or legal process.
            </li>
          </ul>
        </section>

        {/* 5. Cookies and Analytics */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            5. Cookies and Analytics
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            Waitlyst uses session cookies to keep you signed in after
            authenticating with Google. These cookies are essential for the
            Service to function and are not used for advertising or tracking
            purposes.
          </p>
          <p className="text-gray-700 leading-relaxed">
            We may use basic analytics to understand usage patterns and improve
            the Service. We do not use third-party advertising trackers.
          </p>
        </section>

        {/* 6. Data Retention */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            6. Data Retention
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            We retain your account information for as long as your account is
            active. Transaction records are retained as required for financial
            reporting and dispute resolution purposes.
          </p>
          <p className="text-gray-700 leading-relaxed">
            If you delete your account, we will remove your personal information
            from our active systems. Some information may be retained in backups
            for a limited period or as required by law.
          </p>
        </section>

        {/* 7. Your Rights */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            7. Your Rights
          </h2>
          <p className="text-gray-700 leading-relaxed mb-3">
            You have the right to:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2">
            <li>
              <strong>Access your data:</strong> Request a copy of the personal
              information we hold about you.
            </li>
            <li>
              <strong>Delete your data:</strong> Request that we delete your
              account and associated personal information.
            </li>
            <li>
              <strong>Correct your data:</strong> Update your information by
              updating your linked Google account profile.
            </li>
          </ul>
          <p className="text-gray-700 leading-relaxed mt-3">
            To exercise these rights, contact us at the email address listed
            below.
          </p>
        </section>

        {/* 8. Children's Privacy */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            8. Children&apos;s Privacy
          </h2>
          <p className="text-gray-700 leading-relaxed">
            Waitlyst is not intended for use by anyone under the age of 18. We
            do not knowingly collect personal information from children under 18.
            If we learn that we have collected information from a child under 18,
            we will take steps to delete that information promptly.
          </p>
        </section>

        {/* 9. Changes to This Policy */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            9. Changes to This Policy
          </h2>
          <p className="text-gray-700 leading-relaxed">
            We may update this Privacy Policy from time to time. When we make
            changes, we will update the &ldquo;Last updated&rdquo; date at the top of this
            page. Your continued use of Waitlyst after changes are posted
            constitutes your acceptance of the updated policy. We encourage you
            to review this policy periodically.
          </p>
        </section>

        {/* 10. Contact Information */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            10. Contact Information
          </h2>
          <p className="text-gray-700 leading-relaxed">
            If you have questions about this Privacy Policy or your personal
            data, please contact us at{" "}
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
