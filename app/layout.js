import { Analytics } from '@vercel/analytics/next';
import '../styles/styles.css';
import '../styles/theme-purple-green.css';

export const metadata = {
  title: 'XAS Workbench',
  description: 'A browser-based workbench for XAFS preprocessing, normalization, EXAFS extraction, and Fourier transforms'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
