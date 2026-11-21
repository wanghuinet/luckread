# Third-party component notice

## ccrsxx/twitter-clone

The interaction-card layout and component composition in `LuckReadSocialPostCard.tsx` are adapted from the MIT-licensed project:

- Source: https://github.com/ccrsxx/twitter-clone
- Adapted component patterns: `src/components/tweet/tweet.tsx`, `src/components/tweet/tweet-stats.tsx`, `src/components/user/user-details.tsx`
- Original copyright: Copyright (c) 2022 ccrsxx
- Upstream license: MIT

The upstream project uses Firebase/Firestore for its own backend. LuckRead does not import that backend logic; the adapted card uses LuckRead's existing W01 APIs and W05 social authority.

The original MIT license terms require this copyright and permission notice to be retained with copies or substantial portions of the software:

```text
MIT License

Copyright (c) 2022 ccrsxx

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```


## Reused frontend foundation: ccrsxx/twitter-clone

The Tailwind configuration, PostCSS configuration, base interaction styles, font-face definitions, landing layout, and interaction-feed presentation added for this migration are copied or adapted from the MIT-licensed upstream repository:

- Source: https://github.com/ccrsxx/twitter-clone
- Reused foundation: upstream `tailwind.config.js`, `postcss.config.js`, `src/styles/globals.scss`, `src/styles/fonts.scss`, `src/components/login/login-main.tsx`, `src/components/sidebar/sidebar.tsx`, `src/components/tweet/tweet.tsx`, and `src/components/tweet/tweet-stats.tsx`
- Copyright: Copyright (c) 2022 ccrsxx
- Backend boundary: no upstream Firebase Authentication, Firestore, Cloud Storage, or upstream backend mutation code is used. LuckRead identity stays in W02 Better Auth, content reads stay in W01/W03, and social mutations use LuckRead's existing API path to W05.

