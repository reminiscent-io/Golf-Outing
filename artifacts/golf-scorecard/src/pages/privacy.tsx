import { Link } from "wouter";
import { ChevronLeft, Trophy } from "lucide-react";

const EFFECTIVE_DATE = "May 12, 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pt-10 pb-6" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-2xl mx-auto">
          <Link
            href="/trips"
            className="inline-flex items-center gap-1 text-xs font-sans mb-4 hover:opacity-80"
            style={{ color: "hsl(42 25% 70%)" }}
          >
            <ChevronLeft size={14} />
            Back to Trips
          </Link>
          <div className="flex items-center gap-3 mb-1">
            <Trophy className="text-primary" size={28} strokeWidth={1.5} />
            <h1 className="text-3xl font-serif text-primary">Privacy Policy & Terms</h1>
          </div>
          <p className="text-sm font-sans" style={{ color: "hsl(42 25% 60%)" }}>
            Effective {EFFECTIVE_DATE}
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8">
        <div
          className="rounded-xl p-6 font-sans text-sm leading-relaxed space-y-6"
          style={{ background: "hsl(42 45% 91%)", color: "hsl(38 30% 18%)" }}
        >
          <section className="space-y-2">
            <p>
              Golf Trip Live Scorecard ("the app", "we", "us") is owned and operated by
              Reminiscent Technologies LLC. This page explains what information we collect,
              how we use it, and the terms you agree to when you use the app.
            </p>
            <p>
              By creating a trip, joining a trip, or entering scores in the app, you agree
              to this Privacy Policy and the Terms of Service below. If you do not agree,
              please do not use the app.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-serif text-xl" style={{ color: "hsl(158 65% 14%)" }}>
              Privacy Policy
            </h2>

            <h3 className="font-600 mt-3">1. Information we collect</h3>
            <p>
              We collect only the minimum information needed to run the app:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-600">Phone number</span> — used solely to authenticate
                you and associate your scores with your player profile.
              </li>
              <li>
                <span className="font-600">Name</span> — the display name you enter when you
                join a trip, so other players can identify you on the leaderboard.
              </li>
              <li>
                <span className="font-600">Handicap and GHIN number</span> — if you choose to
                provide them, used to compute Course Handicap and net scoring.
              </li>
              <li>
                <span className="font-600">Scores and round data</span> — the hole-by-hole
                scores you enter, plus the trips, rounds, and groups you create or join.
              </li>
            </ul>
            <p>
              We do not collect device identifiers, location data, contacts, advertising
              identifiers, or analytics beyond standard server logs needed to operate and
              debug the service.
            </p>

            <h3 className="font-600 mt-3">2. How we use your information</h3>
            <p>
              Your information is used only to operate the app: authenticating you,
              displaying leaderboards, computing handicap-adjusted scoring, and persisting
              your trips so you can return to them later. We do not sell, rent, or share your
              information with third parties for advertising or marketing.
            </p>

            <h3 className="font-600 mt-3">3. Where your data is stored</h3>
            <p>
              All data is stored in a private PostgreSQL database hosted on Replit and
              operated by Reminiscent Technologies LLC. Access is restricted to systems and
              personnel that need it to run the app. We use industry-standard practices to
              protect the database, but no online service can guarantee absolute security.
            </p>

            <h3 className="font-600 mt-3">4. Third-party services</h3>
            <p>
              The app uses GolfCourseAPI to look up course and tee information. Course
              lookups go through our server and do not include your personal information.
              The app is hosted on Replit infrastructure, which processes traffic on our
              behalf.
            </p>

            <h3 className="font-600 mt-3">5. Data retention and deletion</h3>
            <p>
              We retain trip, player, and score data for as long as the trip exists in the
              app. To delete your data, you (or the trip creator) can delete the trip from
              the home screen, or contact us at the address below and we will remove your
              personal information from our database.
            </p>

            <h3 className="font-600 mt-3">6. Children</h3>
            <p>
              The app is not directed to children under 13, and we do not knowingly collect
              information from children under 13. If you believe a child has provided
              information to us, contact us and we will delete it.
            </p>

            <h3 className="font-600 mt-3">7. Changes to this policy</h3>
            <p>
              We may update this policy from time to time. The effective date at the top of
              this page will reflect the latest version. Continued use of the app after
              changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-serif text-xl" style={{ color: "hsl(158 65% 14%)" }}>
              Terms of Service
            </h2>

            <h3 className="font-600 mt-3">1. Use of the app</h3>
            <p>
              The app is provided to help groups of golfers track scores during trips. You
              agree to use it only for lawful purposes and not to interfere with other
              users, attempt to access data you are not authorized to view, or attempt to
              disrupt or reverse-engineer the service.
            </p>

            <h3 className="font-600 mt-3">2. Accounts and trips</h3>
            <p>
              You are responsible for the accuracy of the information you enter, for keeping
              any trip password you set reasonably private, and for the activity that occurs
              under your player profile within a trip.
            </p>

            <h3 className="font-600 mt-3">3. Disclaimer</h3>
            <p>
              The app is provided "as is" and "as available" without warranties of any kind,
              express or implied, including merchantability, fitness for a particular
              purpose, and non-infringement. Scoring calculations (Stableford, Skins,
              Nassau, Net Stroke, Course Handicap) are provided for casual play only and are
              not an official handicap or tournament record.
            </p>

            <h3 className="font-600 mt-3">4. Limitation of liability</h3>
            <p>
              To the maximum extent permitted by law, Reminiscent Technologies LLC and its
              owners, employees, and contractors will not be liable for any indirect,
              incidental, special, consequential, or punitive damages, or any loss of data,
              profits, or goodwill arising out of your use of the app.
            </p>

            <h3 className="font-600 mt-3">5. Termination</h3>
            <p>
              We may suspend or terminate access to the app at any time, with or without
              notice, if we believe these terms have been violated or if we need to take the
              service down for maintenance, security, or other operational reasons.
            </p>

            <h3 className="font-600 mt-3">6. Governing law</h3>
            <p>
              These terms are governed by the laws of the United States and the state in
              which Reminiscent Technologies LLC is organized, without regard to conflict of
              laws principles.
            </p>

            <h3 className="font-600 mt-3">7. Contact</h3>
            <p>
              Questions, data deletion requests, or other inquiries can be sent to:
              <br />
              Reminiscent Technologies LLC
              <br />
              <a
                href="mailto:info@reminiscent.io"
                className="underline"
                style={{ color: "hsl(158 55% 22%)" }}
              >
                info@reminiscent.io
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
