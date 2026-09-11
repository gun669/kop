import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import { bodyFont } from "./fonts";

// Public-facing booking pages get their own font pairing, matching Kula's
// real brand (Freight Big / Sweet Sans Pro on kulayoga.io) — these are
// open-source stand-ins with a similar feel, self-hosted via @fontsource
// (see fonts.ts) so this route doesn't depend on reaching Google Fonts at
// build or request time. Loaded only for this route group so the internal
// staff app keeps its own plain UI font untouched.
export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F3F0E8] text-[#52504E]" style={{ fontFamily: bodyFont }}>
      {children}
    </div>
  );
}
