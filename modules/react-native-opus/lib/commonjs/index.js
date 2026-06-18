"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.saveDecodedDataAsWav = exports.reverseString = exports.promiseNumber = exports.getOBject = exports.getNumbers = exports.destroyOpusDecoder = exports.decodeOpusPacket = exports.decodeOpusFile = exports.decodeOpusData = exports.decodeOpus = exports.createOpusDecoder = exports.callMeLater = void 0;
var _NativeOpus = _interopRequireDefault(require("./NativeOpus.js"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const {
  getOBject,
  getNumbers,
  callMeLater,
  promiseNumber,
  reverseString,
  decodeOpus,
  createOpusDecoder,
  decodeOpusPacket,
  destroyOpusDecoder,
  decodeOpusFile,
  decodeOpusData,
  saveDecodedDataAsWav
} = _NativeOpus.default;
exports.saveDecodedDataAsWav = saveDecodedDataAsWav;
exports.decodeOpusData = decodeOpusData;
exports.decodeOpusFile = decodeOpusFile;
exports.destroyOpusDecoder = destroyOpusDecoder;
exports.decodeOpusPacket = decodeOpusPacket;
exports.createOpusDecoder = createOpusDecoder;
exports.decodeOpus = decodeOpus;
exports.reverseString = reverseString;
exports.promiseNumber = promiseNumber;
exports.callMeLater = callMeLater;
exports.getNumbers = getNumbers;
exports.getOBject = getOBject;
//# sourceMappingURL=index.js.map