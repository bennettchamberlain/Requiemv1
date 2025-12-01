/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Montserrat', 'system-ui', 'sans-serif'],
      },
      transitionProperty: {
        radius: 'border-radius',
      },
      animation: {
        shake: 'shake 0.5s ease-in-out',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-4px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(4px)' },
        },
      },
      fontSize: {
        xxs: '0.625rem',
        tiny: '0.5rem',
      },

      typography: () => ({
        DEFAULT: {
          css: {
            p: {
              '@apply text-base': {},
            },
            li: {
              '@apply text-base': {},
            },
            hr: {
              '@apply mt-6 mb-6 max-w-[95%] mx-auto': {},
            },
            'h1, h2, h3, h4, h5, h6': {
              '@apply mt-0': {},
            },
          },
        },
      }),
    },
  },
};
