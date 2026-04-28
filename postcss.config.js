/**
 * @file postcss.config.js
 * @description PostCSS pipeline used by Next.js to transform Tailwind directives
 *              and add vendor prefixes via Autoprefixer.
 */

module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
