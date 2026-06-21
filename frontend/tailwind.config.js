/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#7F77DD',
          hover: '#6c64cc',
          subtle: '#EEEDFE',
          muted: '#534AB7',
          strong: '#3C3489',
        },
        ink: {
          50: '#F1EFE8',
          100: '#D3D1C7',
          400: '#888780',
          600: '#5F5E5A',
          950: '#18181b',
        },
        success: { DEFAULT: '#639922', bg: '#EAF3DE' },
        warning: { DEFAULT: '#BA7517', bg: '#FAEEDA' },
        danger:  { DEFAULT: '#E24B4A', bg: '#FCEBEB' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '7px',
        card: '7px',
        lg: '12px',
      },
      boxShadow: {
        focus: '0 0 0 3px rgba(127,119,221,.2)',
      },
    },
  },
  plugins: [],
};
