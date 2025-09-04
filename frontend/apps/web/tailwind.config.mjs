/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      typography: () => ({
        DEFAULT: {
          css: {
            hr: {
              '@apply mt-6 mb-6 max-w-[90%] mx-auto': {},
            },
          },
        },
      }),
    },
  },
};
