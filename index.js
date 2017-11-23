'use strict';
const path = require('path');
const eslint = require('eslint');
const globby = require('globby');
const isEqual = require('lodash.isequal');
const multimatch = require('multimatch');
const arrify = require('arrify');
const optionsManager = require('./lib/options-manager');

const mergeReports = reports => {
	// Merge multiple reports into a single report
	let results = [];
	let errorCount = 0;
	let warningCount = 0;

	for (const report of reports) {
		results = results.concat(report.results);
		errorCount += report.errorCount;
		warningCount += report.warningCount;
	}

	return {
		errorCount,
		warningCount,
		results
	};
};

const processReport = (report, opts) => {
	report.results = opts.quiet ? eslint.CLIEngine.getErrorResults(report.results) : report.results;
	return report;
};

const runEslint = (paths, opts) => {
	const config = optionsManager.buildConfig(opts);
	const engine = new eslint.CLIEngine(config);
	const report = engine.executeOnFiles(paths, config);

	return processReport(report, opts);
};

exports.lintText = (str, opts) => {
	opts = optionsManager.preprocess(opts);

	if (opts.overrides && opts.overrides.length > 0) {
		const overrides = opts.overrides;
		delete opts.overrides;

		const filename = path.relative(opts.cwd, opts.filename);

		const foundOverrides = optionsManager.findApplicableOverrides(filename, overrides);
		opts = optionsManager.mergeApplicableOverrides(opts, foundOverrides.applicable);
	}

	opts = optionsManager.buildConfig(opts);
	const defaultIgnores = optionsManager.getIgnores({}).ignores;

	if (opts.ignores && !isEqual(defaultIgnores, opts.ignores) && typeof opts.filename !== 'string') {
		throw new Error('The `ignores` option requires the `filename` option to be defined.');
	}

	if (opts.filename) {
		const filename = path.relative(opts.cwd, opts.filename);
		const isIgnored = multimatch(filename, opts.ignores).length > 0;
		const isGitIgnored = !optionsManager.getGitIgnoreFilter(opts)(opts.filename);

		if (isIgnored || isGitIgnored) {
			return {
				errorCount: 0,
				warningCount: 0,
				results: [{
					errorCount: 0,
					filePath: filename,
					messages: [],
					warningCount: 0
				}]
			};
		}
	}

	const engine = new eslint.CLIEngine(opts);
	const report = engine.executeOnText(str, opts.filename);

	return processReport(report, opts);
};

exports.lintFiles = (patterns, opts) => {
	opts = optionsManager.preprocess(opts);

	const isEmptyPatterns = patterns.length === 0;
	const ignoreFilter = optionsManager.getGitIgnoreFilter(opts);

	patterns = isEmptyPatterns ? opts.patterns : arrify(patterns);

	return globby(patterns, {ignore: opts.ignores, nodir: true, cwd: opts.cwd}).then(paths => {
		// Filter out unwanted file extensions
		// For silly users that don't specify an extension in the glob pattern
		if (!isEmptyPatterns) {
			paths = paths.filter(filePath => {
				const ext = path.extname(filePath).replace('.', '');
				return opts.extensions.indexOf(ext) !== -1;
			});
		}

		paths = paths.filter(ignoreFilter);

		if (!(opts.overrides && opts.overrides.length > 0)) {
			return runEslint(paths, opts);
		}

		const overrides = opts.overrides;
		delete opts.overrides;

		const grouped = optionsManager.groupConfigs(paths, opts, overrides);

		return mergeReports(grouped.map(data => runEslint(data.paths, data.opts)));
	});
};

exports.getFormatter = eslint.CLIEngine.getFormatter;
exports.getErrorResults = eslint.CLIEngine.getErrorResults;
exports.outputFixes = eslint.CLIEngine.outputFixes;
