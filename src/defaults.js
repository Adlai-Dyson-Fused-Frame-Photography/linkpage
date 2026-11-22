// Placeholder content shown on first run. Everything here is editable in /admin.
const icon = (mode = 'auto', lib = 'link') => ({ mode, lib, file: '', for: '' });

export const DEFAULT_CONFIG = {
  site: {
    title: 'Links | YOUR NAME',
    description: 'View the link in bio for YOUR NAME.',
    lang: 'en', url: '', robots: true, ogImage: '', favicon: '', headHtml: '', trackClicks: true
  },
  profile: { name: 'Your Name', bio: 'Photographer ', avatar: '', avatarShape: 'circle' },
  theme: {
    layout: 'bento', bg: '#020617', text: '#f1f5f9', primary: '#94fdf8', secondary: '#3b82f6',
    radius: 24, blur: 24, glass: 8, glow: true, float: true, animate: true, font: 'system', customCss: ''
  },
  banner: { enabled: true, text: 'Welcome! Edit or remove this banner in the admin panel', url: 'http://localhost:3000/setup' },
  footer: {
    text: '© {year} YOUR NAME',
    links: [
      { label: 'Privacy Policy', url: 'https://example.com/privacy' },
      { label: 'Terms & Conditions', url: 'https://example.com/terms' }
    ],
    showGithub: true, githubUrl: 'https://github.com/Adlai-Dyson-Fused-Frame-Photography/linkpage'
  }
};

export const DEFAULT_BLOCKS = [
  { id: 'website', type: 'link', title: 'My Website', desc: 'Portfolio, about me & more', url: 'https://example.com', size: 2, color: '', icon: icon('lib', 'globe'), newTab: true },
  { id: 'galleries', type: 'link', title: 'Galleries', desc: 'Find your gallery', url: 'https://example.com/galleries', size: 1, color: '#2dd4bf', icon: icon('lib', 'image'), newTab: true },
  {
    id: 'socials', type: 'social', title: 'Connect & Follow', desc: 'Find me across the web', size: 3,
    items: [
      { id: 'soc-ig', title: 'Instagram', url: 'https://instagram.com/yourname', color: '#e1306c', icon: icon() },
      { id: 'soc-yt', title: 'YouTube', url: 'https://youtube.com/@yourname', color: '#ff0000', icon: icon() },
      { id: 'soc-li', title: 'LinkedIn', url: 'https://linkedin.com/in/yourname', color: '#0a66c2', icon: icon() },
      { id: 'soc-gh', title: 'GitHub', url: 'https://github.com/yourname', color: '', icon: icon('lib', 'github') }
    ]
  },
  { id: 'shop', type: 'link', title: 'Shop', desc: 'Prints, downloads and more', url: 'https://example.com/shop', size: 1, color: '#a78bfa', icon: icon('lib', 'cart'), newTab: true },
  { id: 'blog', type: 'link', title: 'Read the Blog', desc: 'Stories, tips and behind the scenes', url: 'https://example.com/blog', size: 2, color: '#3b82f6', icon: icon('lib', 'book'), newTab: true },
  {
    id: 'more', type: 'group', title: 'More links', desc: 'Click to expand', size: 3, open: false, icon: icon('lib', 'hash'),
    items: [
      { id: 'more-1', title: 'Example link one', url: 'https://example.com/one', color: '', icon: icon() },
      { id: 'more-2', title: 'Example link two', url: 'https://example.com/two', color: '', icon: icon() }
    ]
  },
  { id: 'contact', type: 'link', title: 'Email me', desc: 'hello@example.com', url: 'mailto:hello@example.com', size: 3, color: '', icon: icon('lib', 'mail'), newTab: false }
];
