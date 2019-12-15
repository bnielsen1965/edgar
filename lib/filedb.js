
const Path = require('path');
const NeDB = require('nedb');

const DataPath = Path.resolve('./data');
const DatabaseFile = 'files.nedb';
const DatabaseFilePath = Path.join(DataPath, DatabaseFile);

class FileDB {
	constructor () {
		this.db = new NeDB({
			filename: DatabaseFilePath,
			autoload: true
		});
	}

	create (filePath) {
		this.db.insert(doc, (error, doc) => {

		});
	}

	read () {

	}

	update () {

	}

	delete () {

	}

	find () {
		
	}
};

module.exports = FileDB;
