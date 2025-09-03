/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      typography: () => ({
        DEFAULT: {
          css: {
            // Example of applying Tailwind classes to Markdown elements.
            // After tinkering I discovered that the defaults should work for
            // now and that our preformatted text styling was why things looked
            // sub-optimal. It took a minute to get this figured out, so I'm leaving
            // the config file to save future "us" some time.
            // h1: {
            //   '@apply my-0': {},
            // },
          },
        },
      }),
    },
  },
};
