
const EdgarArchive = require('./lib/edgararchive');
//EdgarArchive.getFullIndex()
//EdgarArchive.getYearIndex(2018)
//EdgarArchive.getQuarterXBRLIndex(2018, 3)
//getReports([{ year: 2018, quarter: 1 }, { year: 2018, quarter: 2 }, { year: 2018, quarter: 3 }], '1318605')// '0000936468')// '1318605')
getReports([{ year: 2018, quarter: 3 }], '1274494',)// '63908')// '0000936468')// '1318605')
	.then(reports => {

	})
/*
EdgarArchive.getCompany10qIndex(2018, 3, '1318605')
	.then(index => {
		return EdgarArchive.getCompany10q(index[0]);
	})
	.then(form10q => {
//		console.log(form10q);//JSON.stringify(index, null, 2))
	})
	*/
	.catch(error => {
		console.log(error);
		process.exit(1);
	});


async function getReports(periods, cik) {
	let period;
	while (period = periods.shift()) {
		let indicies = await EdgarArchive.getCompany10qIndex(period.year, period.quarter, cik);
		let index;
		while (index = indicies.shift()) {
			let report = await EdgarArchive.getCompany10q(index);

		}
	}
}
