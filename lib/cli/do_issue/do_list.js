/*
 * Copyright (c) 2017, Joyent, Inc.
 *
 * `jirash issue list FILTER`
 */

var tabula = require('tabula');
var UsageError = require('cmdln').UsageError;
var vasync = require('vasync');
var VError = require('VError');

var common = require('../../common');


var columnsDefault = 'key,summaryClipped,assignee,reporter,p,stat,created,updated'.split(/,/g);
var columnsDefaultLong = 'key,priority,status,type,reporter,assignee,created,updated,resolved,summary'.split(/,/g);
var sortDefault = null;

function do_list(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 1) {
        return cb(new UsageError('incorrect number of args'));
    }

    var self = this;
    var log = this.log;
    var filterIdOrName = args[0];

    var columns = columnsDefault;
    if (opts.o) {
        columns = opts.o;
    } else if (opts.long) {
        columns = columnsDefaultLong;
    }

    vasync.pipeline({arg: {cli: this.top}, funcs: [
        function getFilterById(ctx, next) {
            if (!/^\d+$/.test(filterIdOrName)) {
                next();
                return;
            }

            ctx.cli.jirashApi.getFilter(filterIdOrName, function (err, filter) {
                ctx.filter = filter;
                log.trace({filter: filter}, 'getFilterById');
                next(err);
            });
        },

        function getFilterByName(ctx, next) {
            if (ctx.filter) {
                next();
                return;
            }

            ctx.cli.jirashApi.getFavouriteFilters(function (err, filters) {
                var term = filterIdOrName.toLowerCase();

                // First try an exact name match;
                for (var i = 0; i < filters.length; i++) {
                    if (filters[i].name.toLowerCase() === term) {
                        ctx.filter = filters[i];
                        next();
                        return;
                    }
                }

                // Next, try a whole word match.
                var matches = [];
                var pat = new RegExp('\\b' + term + '\\b', 'i');
                filters.forEach(function (filter) {
                    if (pat.test(filter.name)) {
                        matches.push(filter);
                    }
                });
                if (matches.length === 0) {
                    next(new VError('no favourite filter names match "%s"',
                        filterIdOrName));
                } else if (matches.length > 1) {
                    next(new VError(
                        'filter term "%s" is ambiguous, it '
                            + 'matches %d filters: "%s"',
                        filterIdOrName,
                        matches.length,
                        matches.map(
                            function (f) { return f.name; }).join('", "')
                    ));
                } else {
                    ctx.filter = matches[0];
                    next();
                }
            });
        },

        function listEm(ctx, next) {
            var fields;
            if (opts.long) {
                fields = ['summary', 'reporter', 'assignee', 'priority',
                    'issuetype', 'status', 'created', 'updated',
                    'resolutiondate'];
            } else if (opts.json || opts.o) {
                // nothing, want all fields (TODO: improve this)
            } else {
                fields = ['summary', 'reporter', 'assignee', 'priority',
                    'status', 'created', 'updated'];
            }

            // XXX paging with a searchPaging or whatever
            ctx.cli.jirashApi.search({
                jql: ctx.filter.jql,
                fields: fields
            }, function (err, page) {
                ctx.issues = page.issues;
                next(err);
            });
        },

        function printEm(ctx, next) {
            if (opts.json) {
                common.jsonStream(ctx.issues);
            } else {
                ctx.issues.forEach(function (issue) {
                    var fields = issue.fields;
                    issue.summaryClipped = (fields.summary.length > 40
                        ? fields.summary.slice(0, 39) + '\u2026'
                        : fields.summary);
                    issue.summary = fields.summary;
                    issue.assignee = (fields.assignee
                        && fields.assignee.name || null);
                    issue.reporter = fields.reporter.name;
                    issue.p = fields.priority.name[0];
                    issue.priority = fields.priority.name;
                    issue.stat = fields.status.name.slice(0, 4);
                    issue.status = fields.status.name;
                    issue.created = fields.created.slice(0, 10);
                    issue.updated = fields.updated.slice(0, 10);
                    issue.resolved = fields.resolutiondate
                        && fields.resolutiondate.slice(0, 10);
                    issue.type = (fields.issuetype
                        && fields.issuetype.name || null);
                });
                tabula(ctx.issues, {
                    skipHeader: opts.H,
                    columns: columns,
                    sort: opts.s,
                    dottedLookup: true
                });
            }
            next();
        }
    ]}, cb);
}

do_list.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
].concat(common.getCliTableOptions({
    includeLong: true,
    sortDefault: sortDefault
}));

do_list.aliases = ['ls'];

do_list.synopses = ['{{name}} {{cmd}} [OPTIONS] FILTER'];

do_list.completionArgtypes = ['jirafilter', 'none'];

do_list.help = [
    'List issues in the given JIRA filter.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'FILTER is a filter ID, or the name or partial name match of your',
    'favourite filters. Use `jirash filter list` to list favourite filters.'
].join('\n');

module.exports = do_list;