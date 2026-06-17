const assert = require('assert');
const { extractYouTubeVideoId } = require('../server');

const id = 'GKOkOtLGEpc';
const cases = [
  [`https://www.youtube.com/watch?v=${id}`, id],
  [`https://youtube.com/watch?v=${id}&si=abc123`, id],
  [`https://youtu.be/${id}?si=abc123`, id],
  [`https://www.youtube.com/shorts/${id}?feature=share`, id],
  [`https://www.youtube.com/embed/${id}`, id],
  [`https://m.youtube.com/watch?v=${id}`, id],
  [id, id],
  ['https://example.com/not-youtube', ''],
  ['not a url', ''],
];

for (const [input, expected] of cases) {
  assert.strictEqual(extractYouTubeVideoId(input), expected, input);
}

console.log('YouTube parser tests passed');
