

const Path = require('path');
const HTTPS = require('https');
const FS = require('fs');
const ZLib = require('zlib');
const Readable = require('stream').Readable;
const ReadLine = require('readline');
const XBRL = require('./xbrl');

const FilesPath = Path.resolve('./files');
const ArchivePath = Path.join(FilesPath, 'archive');
const SECUrl = 'https://www.sec.gov'; // TODO if url is provided then use .replace(/\/$/, '') to strip ending slash

const ArchivesIndexFile = 'index.json';
const ArchivesXBRLFile = 'xbrl.gz';

const ArchivesIndexFilePath = Path.join(ArchivePath, ArchivesIndexFile);
const ArchivesUrl = SECUrl + '/Archives';// /edgar/full-index'; // TODO if url is provided then use .replace(/\/$/, '') to strip ending slash
const ArchivesIndexUrl = ArchivesUrl + '/edgar/full-index';
//const ArchiveIndexURL = ArchivesIndexUrl + '/' + ArchivesIndexFile;
const ArchiveIndexExpireDays = 1;

const TickerCikFile = 'company_tickers.json';
const TickerCikFilePath = Path.join(FilesPath, TickerCikFile);
const TickerCikURL = SECUrl + '/files/' + TickerCikFile;
const TickerCikExpireDays = 1;

const DayMs = 1000*60*60*24;

class EdgarArchive {
	// returns the full index as an object
	static async getFullIndex () {
		let index = await EdgarArchive.getArchivesFile(
			ArchivesIndexFilePath,
			ArchivesIndexUrl + '/' + ArchivesIndexFile,
			ArchiveIndexExpireDays * DayMs
		);
		return JSON.parse(index.toString());
	}

	static async getYearIndex (year) {
		let index = await EdgarArchive.getArchivesFile(
			Path.join(ArchivePath, year.toString(), ArchivesIndexFile),
			ArchivesIndexUrl + '/' + year + '/' + ArchivesIndexFile,
			ArchiveIndexExpireDays * DayMs
		);
		return JSON.parse(index.toString());
	}

	static async getQuarterIndex (year, quarter) {
		let index = await EdgarArchive.getArchivesFile(
			Path.join(ArchivePath, year.toString(), 'QTR' + quarter, ArchivesIndexFile),
			ArchivesIndexUrl + '/' + year + '/QTR' + quarter + '/' + ArchivesIndexFile,
			ArchiveIndexExpireDays * DayMs
		);
		return JSON.parse(index.toString());
	}

	// returns array of report index objects from quarter's xbrl index
	static async getQuarterXBRLIndex (year, quarter) {
		let xbrlgz = await EdgarArchive.getArchivesFile(
			Path.join(ArchivePath, year.toString(), 'QTR' + quarter, ArchivesXBRLFile),
			ArchivesIndexUrl + '/' + year + '/QTR' + quarter + '/' + ArchivesXBRLFile,
			ArchiveIndexExpireDays * DayMs
		);
		let xbrlBuffer = await EdgarArchive.gunzip(xbrlgz);
		return await EdgarArchive.xbrlIndexToJSON(xbrlBuffer.toString());
	}

	// returns array of 10-Q indecies for the given CIK
	static async getCompany10qIndex (year, quarter, cik) {
		let xbrlIndex = await EdgarArchive.getQuarterXBRLIndex(year, quarter);
		let cikIndex = xbrlIndex.filter(index => {
			return EdgarArchive.cikMatch(index.CIK, cik) && (index['Form Type'] === '10-Q' || index['Form Type'] === '10-K');
		});
		if (!cikIndex.length) {
			throw new Error('No 10-Q form for CIK ' + cik + ' in year ' + year + ' and quarter ' + quarter);
		}
		return cikIndex;
	}

	// test if cik values match
	static cikMatch (cik1, cik2) {
		return ('' + cik1).replace(/^0{0,9}/, '') === ('' + cik2).replace(/^0{0,9}/, '');
	}

	static getPeriodEndDateContexts (xbrl, periodEndDate) {
		let contexts = XBRL.extractXBRLFields('context', xbrl, ['id']).filter(context => {
			// filter out if has entity with segment field
			let entity = XBRL.extractXBRLFields('entity', context.value);
			if (!entity.length || entity.length > 1) {
				return false;
			}
			let segment = XBRL.extractXBRLFields('segment', entity[0].value);
			if (segment.length) {
				return false;
			}
			// filter out if does not have a single period instant that matches target period end date
			let period = XBRL.extractXBRLFields('period', context.value);
			if (!period.length || period.length > 1) {
				return false;
			}
			let instant = XBRL.extractXBRLFields('instant', period[0].value);
			if (!instant.length || instant.length > 1) {
				return false;
			}
			if (instant[0].value === periodEndDate) {
				return true;
			}
			return false;
		});
		return contexts;
	}

	static getContextField (xbrl, field, contexts) {
		let contextRefs = contexts.map(context => context.params.id);
		let fields = XBRL.extractXBRLFields(field, xbrl, ['contextRef', 'decimals', 'unitRef']).filter(f => contextRefs.indexOf(f.params.contextRef) > -1);
		if (fields.length === 1) {
			return fields[0];
		}
		if (fields.length === 0) {
			console.log('NO CONTEXT FIELD')
			return;
		}
		console.log('MULTIPLE CONTEXT FIELDS')
		return;
	}

	static async getCompany10q (cikIndex) {
		let form10qPath = await EdgarArchive.getArchivesFilePath(
			Path.join(FilesPath, cikIndex.Filename),
			ArchivesUrl + '/' + cikIndex.Filename,
			ArchiveIndexExpireDays * DayMs
		);
		let blocks = await XBRL.extractXBRLFromFile(form10qPath);
		console.log('BLOCKS', blocks.length);
		blocks.forEach((xbrl, i) => {
			console.log('BLOCK', i)
			let periodEndDate = XBRL.getDocumentPeriodEndDate(xbrl);
			if (!periodEndDate) {
				return;
			}
			console.log('PED', periodEndDate)
			let contexts = EdgarArchive.getPeriodEndDateContexts (xbrl, periodEndDate);
			console.log('CONTEXTS', contexts.length)

			let cashAndCashEquivalentsAtCarryingValueField = EdgarArchive.getContextField(xbrl, 'CashAndCashEquivalentsAtCarryingValue', contexts);
			console.log('F', cashAndCashEquivalentsAtCarryingValueField);
/*
			let cashAndCashEquivalentsAtCarryingValue;
			let cashAndCashEquivalentsAtCarryingValueFields = XBRL.extractXBRLFields('CashAndCashEquivalentsAtCarryingValue', xbrl, ['contextRef']);
			console.log('CC', cashAndCashEquivalentsAtCarryingValueFields.length)
			if (cashAndCashEquivalentsAtCarryingValueFields.length > 1) {
//				console.log('############### MULTIPLE', cashAndCashEquivalentsAtCarryingValueFields);
				cashAndCashEquivalentsAtCarryingValueFields.map(field => {
					console.log('CREF', field.params.contextRef, contexts.length)
					if (field.params.contextRef && contexts.filter(context => { return context.params.id === field.params.contextRef; }).length) {
						console.log('CONTEXT MATCH', field)
						cashAndCashEquivalentsAtCarryingValue = field;
					}
					let contextRef = XBRL.extractXBRLFields('contextRef', field.value);
				});
			}
			else {
//				console.log('############### ONLY ONE', cashAndCashEquivalentsAtCarryingValueFields);
				cashAndCashEquivalentsAtCarryingValue = cashAndCashEquivalentsAtCarryingValueFields.length ? cashAndCashEquivalentsAtCarryingValueFields[0].value : 'UNKNOWN';
			}
*/
			let contextFields = [
				'CashAndCashEquivalentsAtCarryingValue',
				'RestrictedCashCurrent',
				'AccountsReceivableNetCurrent',
				'InventoryNet',
				'PrepaidExpenseAndOtherAssetsCurrent',
				'AssetsCurrent',
				'PropertyPlantAndEquipmentNet',
				'IntangibleAssetsNetExcludingGoodwill',
				'Goodwill',
				'LongTermAccountsNotesAndLoansReceivableNetNoncurrent',
				'RestrictedCashAndCashEquivalentsNoncurrent',
				'OtherAssetsNoncurrent',
				'Assets',
				'AccountsPayableCurrent',
				'AccruedAndOtherCurrentLiabilities',
				'ContractWithCustomerLiabilityCurrent',
				'ResaleValueGuaranteesCurrentPortion',
				'CustomerDepositsCurrent',
				'LongTermDebtAndCapitalLeaseObligationsCurrent',
				'DueToRelatedPartiesCurrent',
				'LiabilitiesCurrent',
				'LongTermDebtAndCapitalLeaseObligations',
				'DueToRelatedPartiesNoncurrent',
				'ConvertibleSeniorNotesIssueToRelatedPartiesNonCurrent',
				'ContractWithCustomerLiabilityNoncurrent',
				'ResaleValueGuaranteesNoncurrentPortion',
				'OtherLiabilitiesNoncurrent',
				'Liabilities',
				'CommitmentsAndContingencies',
				'RedeemableNoncontrollingInterestEquityCarryingAmount',
				'TemporaryEquityCarryingAmountAttributableToParent',
				'PreferredStockValue',
				'CommonStockValue',
				'AdditionalPaidInCapitalCommonStock',
				'AccumulatedOtherComprehensiveIncomeLossNetOfTax',
				'RetainedEarningsAccumulatedDeficit',
				'StockholdersEquity',
				'MinorityInterest',
				'LiabilitiesAndStockholdersEquity',
				'PreferredStockParOrStatedValuePerShare',
				'PreferredStockSharesAuthorized',
				'PreferredStockSharesIssued',
				'PreferredStockSharesOutstanding',
				'CommonStockParOrStatedValuePerShare',
				'CommonStockSharesAuthorized',
				'CommonStockSharesIssued',
				'CommonStockSharesOutstanding',
				'SalesRevenueGoodsNet',
				'OperatingLeasesIncomeStatementLeaseRevenue',
				'SalesRevenueAutomotive',
				'SalesRevenueEnergyServices',
				'SalesRevenueServicesAndOtherNet',
				'Revenues',
				'CostOfGoodsSold',
				'CostOfAutomotiveLeasing',
				'CostOfRevenuesAutomotive',
				'CostOfServicesEnergyServices',
				'CostOfServicesAndOther',
				'CostOfRevenue',
				'GrossProfit',
				'ResearchAndDevelopmentExpense',
				'SellingGeneralAndAdministrativeExpense',
				'RestructuringAndOtherExpenses',
				'OperatingExpenses',
				'OperatingIncomeLoss',
				'InvestmentIncomeInterest',
				'InterestExpense',
				'OtherNonoperatingIncomeExpense',
				'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
				'IncomeTaxExpenseBenefit',
				'ProfitLoss',
				'NetIncomeLossAttributableToNoncontrollingInterest',
				'NetIncomeLossAvailableToCommonStockholdersBasic',
				'EarningsPerShareBasic',
				'EarningsPerShareDiluted',
				'WeightedAverageNumberOfSharesOutstandingBasic',
				'WeightedAverageNumberOfDilutedSharesOutstanding',
				'NetIncomeLoss',
				'OtherComprehensiveIncomeLossReclassificationAdjustmentFromAOCIOnDerivativesNetOfTax',
				'OtherComprehensiveIncomeLossForeignCurrencyTransactionAndTranslationAdjustmentNetOfTax',
				'OtherComprehensiveIncomeLossNetOfTaxPortionAttributableToParent',
				'ComprehensiveIncomeNetOfTax',
				'DepreciationAmortizationAndImpairment',
				'ShareBasedCompensation',
				'AmortizationOfFinancingCostsAndDiscounts',
				'InventoryWriteDown',
				'GainLossOnSaleOfPropertyPlantEquipment',
				'ForeignCurrencyTransactionGainLossBeforeTax',
				'GainsLossOnAcquisition',
				'NoncashInterestIncomeExpenseAndOtherOperatingActivities',
				'IncreaseDecreaseInAccountsReceivable',
				'IncreaseDecreaseInInventories',
				'IncreaseDecreaseInOperatingLeaseVehicles',
				'IncreaseDecreaseInPrepaidDeferredExpenseAndOtherAssets',
				'IncreaseDecreaseInOtherOperatingAssetsAndNotesReceivables',
				'IncreaseDecreaseInAccountsPayableAndAccruedLiabilities',
				'IncreaseDecreaseInDeferredRevenue',
				'IncreaseDecreaseInDeferredRevenueAndCustomerAdvancesAndDeposits',
				'IncreaseDecreaseInResaleValueGuarantee',
				'IncreaseDecreaseInOtherNoncurrentLiabilities',
				'NetCashProvidedByUsedInOperatingActivities',
				'PaymentsToAcquirePropertyPlantAndEquipment',
				'PaymentsForSolarEnergySystemsLeasedAndToBeLeased',
				'PaymentsToAcquireBusinessesNetOfCashAcquired',
				'NetCashProvidedByUsedInInvestingActivities',
				'ProceedsFromIssuanceOfCommonStock',
				'ProceedsFromConvertibleAndOtherDebt',
				'RepaymentsOfConvertibleAndOtherDebt',
				'RepaymentsOfRelatedPartyDebt',
				'ProceedsFromRepaymentsOfSecuredDebt',
				'ProceedsFromIssuanceOfSharesUnderIncentiveAndShareBasedCompensationPlansIncludingStockOptions',
				'ProceedsFromRepaymentsOfLongTermDebtAndCapitalSecurities',
				'PaymentsOfFinancingCosts',
				'PaymentsForHedgeFinancingActivities',
				'ProceedsFromHedgeFinancingActivities',
				'ProceedsFromIssuanceOfWarrants',
				'PaymentsForRepurchaseOfWarrants',
				'ProceedsFromMinorityShareholders',
				'PaymentsToMinorityShareholders',
				'PaymentsForBuyOutsOfNoncontrollingInterestsInSubsidiaries',
				'NetCashProvidedByUsedInFinancingActivities',
				'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
				'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect',
				'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
				'NoncashOrPartNoncashAcquisitionValueOfAssetsAcquired1',
				'NonCashEstimatedFairMarketValueOfManufacturingFacility'
			];
			let block = {
				EntityRegistrantName: XBRL.extractXBRLFields('EntityRegistrantName', xbrl)[0],
				DocumentType: XBRL.extractXBRLFields('DocumentType', xbrl)[0],
				AmendmentFlag: XBRL.extractXBRLFields('AmendmentFlag', xbrl)[0] === 'false' ? false : true,
				DocumentPeriodEndDate: XBRL.extractXBRLFields('DocumentPeriodEndDate', xbrl)[0],
				DocumentFiscalYearFocus: XBRL.extractXBRLFields('DocumentFiscalYearFocus', xbrl)[0],
				DocumentFiscalPeriodFocus: XBRL.extractXBRLFields('DocumentFiscalPeriodFocus', xbrl)[0],
				TradingSymbol: XBRL.extractXBRLFields('TradingSymbol', xbrl)[0],
				EntityCentralIndexKey: XBRL.extractXBRLFields('EntityCentralIndexKey', xbrl)[0],
//				EntityCommonStockSharesOutstanding: (XBRL.extractXBRLFields('EntityCommonStockSharesOutstanding', xbrl)[0]),
//				CashAndCashEquivalentsAtCarryingValue: EdgarArchive.getContextField(xbrl, 'CashAndCashEquivalentsAtCarryingValue', contexts),
//				RestrictedCashCurrent: EdgarArchive.getContextField(xbrl, 'RestrictedCashCurrent', contexts),
//				AccountsReceivableNetCurrent: EdgarArchive.getContextField(xbrl, 'AccountsReceivableNetCurrent', contexts),

			};
			contextFields.forEach(field => {
				let f = EdgarArchive.getContextField(xbrl, field, contexts);
				if (f) {
					if (f.params.decimals && !isNaN(f.params.decimals)) {
						let decimals = -1 * parseInt(f.params.decimals);
						f.value = parseInt(f.value) * Math.pow(10, decimals);
					}
					block[field] = f;
				}
			})
			console.log(JSON.stringify(block, null, 2));
			/*
			let values;
			values = EdgarArchive.extractXBRLFields ('EntityRegistrantName', xbrl);
			console.log(i, ':', values)
			console.log(i, ':', EdgarArchive.extractXBRLFields ('DocumentType', xbrl))
			*/
		})
		return '';
	}

	// parse xbrl index string text into array of index objects
	static xbrlIndexToJSON (xbrlString) {
		return new Promise((resolve, reject) => {
			let index = [];
			let stream = EdgarArchive.stringToStream(xbrlString);
			let parseStart = false;
			let header;
			let lineReader = ReadLine.createInterface({ input: stream });
			lineReader
				.on('line', function (line) {
					if (!parseStart && /^[-]+$/.test(line)) {
						parseStart = true;
						return;
					}
					else if (!parseStart) {
						header = line.split('|');
					}
					else {
						let parts = line.split('|');
						if (parts.length === header.length) {
							let item = {};
							header.forEach((column, i) => {
								item[column] = parts[i];
							});
							index.push(item);
						}
						else {
							console.log('Line mismatch: ' + line);
						}
					}
				})
				.on('close', () => {
					resolve(index);
				});
		});
	}

	// returns a readable stream from string content
	static stringToStream (string) {
		let stringStream = new Readable();
		//s._read = () => {}; // redundant? see update below
		stringStream.push(string);
		stringStream.push(null);
		return stringStream;
	}

	// returns content in buffer from gunzipped buffer
	static gunzip (gz) {
		return new Promise((resolve, reject) => {
			ZLib.gunzip(gz, (error, result) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(result);
			});
		});
	}

	static getCikTickers () {
		return new Promise((resolve, reject) => {
			FS.stat(ArchivesIndexFilePath, (error, stat) => {
				if (!error) {
					console.log(stat); // TODO check mtime for expiration
					return require(ArchivesIndexFilePath);
				}
				if (error.code === 'ENOENT') {
					return EdgarArchive.requestIndex();
				}
				reject(error);
			});
		});
	}

	static tickerToCik (ticker) {

	}

	static cikToTicker (cik) {

	}

	// get archive file contents, downloads fresh file if local expires or does not exist
	static async getArchivesFile (archivePath, archiveUrl, expiresMs) {
		return EdgarArchive.readFile(await EdgarArchive.getArchivesFilePath(archivePath, archiveUrl, expiresMs));
		/*
		let localPath = await EdgarArchive.statFile(archivePath);
		if (localPath) {
			return await EdgarArchive.readFile(localPath);
		}
		await EdgarArchive.ensurePathExists(Path.dirname(archivePath));
		return await EdgarArchive.readFile(await EdgarArchive.requestArchiveFile(archiveUrl, archivePath));
		*/
	}

	static async getArchivesFilePath (archivePath, archiveUrl, expiresMs) {
		let localPath = await EdgarArchive.statFile(archivePath);
		if (localPath) {
			return localPath;
		}
		await EdgarArchive.ensurePathExists(Path.dirname(archivePath));
		return await EdgarArchive.requestArchiveFile(archiveUrl, archivePath);
	}

	// return file path if stat succeeds, no path if does not exist, error on failure
	static statFile (filePath, expiresMs) {
		return new Promise((resolve, reject) => {
			FS.stat(filePath, (error, stat) => {
				if (error && error.code === 'ENOENT') {
					resolve();
					return;
				}

				if (error) {
					reject(error);
					return;
				}

				if (Date.now() + expiresMs < stat.mtimeMs) {
					resolve();
					return;
				}

				resolve(filePath);
			});
		});
	}

	// returns the file contents in a buffer
	static readFile (filePath) {
		return new Promise((resolve, reject) => {
			FS.readFile(filePath, (error, data) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(data);
			});
		});
	}

	// create file path if it does not exist
	static ensurePathExists(path) {
		return new Promise((resolve, reject) => {
			FS.mkdir(path, { recursive: true }, error => {
				if (error && error.code !== 'EEXIST') {
					reject(error);
				}
				resolve(path);
			})
		});
	}

	// returns path to successfully downloaded file
	static requestArchiveFile (archiveUrl, archivePath) {
		console.log("RQURL", archiveUrl)
		return new Promise((resolve, reject) => {
			let file = FS.createWriteStream(archivePath);
			file
				.on('ready', () => {
					let req = HTTPS.get(archiveUrl, res => {
						if (res.statusCode !== 200) {
							reject(new Error('Request for ' + archiveUrl + ' failed with status code ' + res.statusCode));
						}
					  res.pipe(file);
					});

					req
						.on('error', error => {
							file.close();
					    FS.unlink(archivePath);
							reject(new Error('Request for ' + archiveUrl + ' failed with error ' + error.message));
					  });
				})
				.on('finish', () => {
					resolve(archivePath);
				})
				.on('error', error => {
					reject(new Error('Request for ' + archiveUrl + ' failed with error ' + error.message));
				});
		});
	}
};

module.exports = EdgarArchive;
