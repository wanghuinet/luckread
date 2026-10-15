# Third-party UI attribution

## ccrsxx/twitter-clone

The responsive discussion-thread composition and parent/reply presentation are adapted from patterns in:

- Source: https://github.com/ccrsxx/twitter-clone
- Adapted references: `src/components/tweet/tweet-with-parent.tsx`, `src/components/tweet/tweet-parent.tsx`, and the parent-reply connector in `src/components/tweet/tweet.tsx`
- Original copyright: Copyright (c) 2022 ccrsxx
- License: MIT

LuckRead adapts only the presentation and parent-child rendering concept. All comment reads and mutations remain connected to LuckRead's existing W01 API adapters and W05 social authority. No upstream Firebase/Firestore code is used.

The upstream MIT license requires retaining the following copyright and permission notice:

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
