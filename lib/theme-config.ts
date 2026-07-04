export const siteConfig = {
  name: 'Meroe',
  description: 'Dedicated virtual account infrastructure on top of Nomba — identity, reconciliation, ledger, and lifecycle, in one API.',
  url: 'https://docs-meroe.netlify.app',

  logo: {
    src: '/logo.svg',
    alt: 'Meroe',
    width: 32,
    height: 32,
  },

  links: {
    github: 'https://github.com/sight-llc/nombadva',
    discord: '',
    twitter: '',
    support: 'mailto:praiseubong@gmail.com',
  },

  footer: {
    companyName: 'Meroe',
    links: [
      { label: 'API Status', href: 'https://meroe.ddns.net/swagger-ui/index.html' },
      { label: 'Dashboard', href: 'https://app-meroe.netlify.app' },
      { label: 'GitHub', href: 'https://github.com/sight-llc/nombadva' },
    ],
  },
}

// Utility: resolves the correct public URL across local dev, Vercel preview, and production
export function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return siteConfig.url
}

// Extended theme config used by the OG image generator
export const themeConfig = {
  colors: {
    light: { accent: '#b45309' },
    dark: { accent: '#f59e0b' },
  },
  ogImage: {
    gradient: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    titleColor: '#f8fafc',
    sectionColor: '#f59e0b',
  },
}
