
const FS = require('fs');

class XBRL {

	// get DocumentPeriodEndDate value from xbrl
	static getDocumentPeriodEndDate (xbrl) {
		let periodEndDateField = XBRL.extractXBRLFields('DocumentPeriodEndDate', xbrl);
		if (periodEndDateField.length > 1 || !periodEndDateField.length) {
			console.log('PED FIELDS', periodEndDateField.length, xbrl.length);
			// multiple or no period end date field
			return;
		}
		return periodEndDateField[0].value;
	}

	// extract a fields from the xbrl content and params if specified
	static extractXBRLFields (field, xbrl, params) {
		let fields = [];
		let regex = new RegExp('\<(?:(?:[^/:>]*):)?' + field + '([^>]*)\>(.*?)\<\/(?:(?:[^/:>]*):)?' + field + '\>', 'gms');
		let match;
		while ((match = regex.exec(xbrl)) !== null) {
			if (match.index === regex.lastIndex) {
				regex.lastIndex++;
			}
			let found = { value: match[2] };
			if (match[1].length && params) {
				found.params = {};
				params.forEach(param => {
					let pv = XBRL.extractFieldParameter(param, match[1]);
					if (pv) {
						found.params[param] = pv;
					}
				});
			}
			fields.push(found);
		}
		return fields;
	}

	// extract the param value from the params string
	static extractFieldParameter (param, params) {
		let regex = new RegExp(param + '="([^"]*)"', 'gms');
		let match;
		if ((match = regex.exec(params)) !== null) {
			return match[1];
		}
	}


	// extract XBRL blocks of text from text file and return as array to text blocks
	static extractXBRLFromFile (filePath) {
		return new Promise((resolve, reject) => {
			let xbrl = [];
			let stream = FS.createReadStream(filePath);
			let inBlock = false;
			let doc;
			stream
				.on('data', data => {
					let chunk = data.toString();
					// work on chunk until nothing left to do
					for (;;) {
						let extract = XBRL.extractXBRLFromChunk(chunk);
						if (extract.block) {
							// complete block
							xbrl.push(extract.block);
							chunk = extract.remainder;
						}
						else if (extract.start) {
							// block start
							inBlock = true;
							doc = extract.start;
							chunk = extract.remainder;
						}
						else if (extract.end) {
							// block end
							doc += extract.end;
							xbrl.push(doc);
							doc = '';
							inBlock = false;
							chunk = extract.remainder;
						}
						else if (inBlock) {
							// append
							doc += extract.remainder;
							chunk = '';
						}
						else {
							// trim
							chunk = '';
						}
						if (!chunk.length) {
							break;
						}
					}
				})
				.on('end', () => {
					resolve(xbrl);
				})
				.on('error', error => {
					reject(error);
				});
		});
	}

	// extract XBRL parts from data chunk
	static extractXBRLFromChunk (chunk) {
//		let startIndex = chunk.search(/\<XBRL\>/gmsi);
		let startIndex = chunk.search(/\<XBRL(?:\s[^\>]*\>|\>)/gmsi);
		let endIndex = chunk.search(/\<\/XBRL\>/gmsi);
		if (startIndex > -1 && endIndex > -1) {
			if (startIndex > endIndex) {
				// found end of previous block
				return {
					end: chunk.substring(0, endIndex + 7),
					remainder: chunk.substring(endIndex + 7)
				};
			}
			// found a complete block
			return {
				block: chunk.substring(startIndex, endIndex + 7),
				remainder: chunk.substring(endIndex + 7)
			};
		}
		else if (startIndex > -1) {
			// found start of new block
			return {
				start: chunk.substring(startIndex),
				remainder: ''
			};
		}
		else if (endIndex > -1) {
			// found end of previous block
			return {
				end: chunk.substring(0, endIndex + 7),
				remainder: chunk.substring(endIndex + 7)
			};
		}
		// no tags found, may be inside or outside a block
		return {
			remainder: chunk
		};
	}

}

module.exports = XBRL;
