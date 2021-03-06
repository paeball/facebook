#!/usr/bin/env nodejs
var _ = require('lodash');
var moment = require('moment');
var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
var nconf = require('nconf');
var debug = require('debug')("dandelion");
var mongo = require('../lib/mongo');
var various = require('../lib/various');

nconf.argv().env();
nconf.file('settings', { file: './config/settings.json' });

function composeNEX(fbtrexobj) {
    var content = {
        id: various.hash({
            'href': fbtrexobj.link,
            'type': "original",
        }),
        original: fbtrexobj.link,
        publicationTime: new Date(fbtrexobj.putime)
    };
    return mongo
        .read("entities", { id: content.id })
        .then(function(exists) {
            if(_.get(exists[0], 'id')  === content.id)
                return null;
            return content;
        });
}

function saveJSON(content) {
    if(!content || !content.id) return;
    return mongo.save("entities", content);
}

function dandelion(partialo) {
    var begin = moment();
    return request.postAsync(
        "https://api.dandelion.eu/datatxt/nex/v1/",
        { form: {
            token: nconf.get("dandelion"),
            url: partialo.original
        } }
        ).then(function (response, body) {
            // response.headers['x-dl-units-reset']
            debug("Tested %s, published %s (%s) units left %d",
                    partialo.original,
                    moment(partialo.publicationTime).format(),
                    moment.duration(moment() - moment(partialo.publicationTime)).humanize(),
                    response.headers['x-dl-units-left']);
            if(_.parseInt(response.headers['x-dl-units-left']) < 2) {
                console.log("Units terminated!");
                process.exit(0);
            }
            return _.extend(partialo, JSON.parse(response.body));
        })
        .catch(function(error) {
            debug("Error with %s: %s", partialo.original, error);
            return null;
        })
        .then(function(e) {
            /* debug("Dandelion get completed in %d seconds",
                moment.duration(moment() - begin).asSeconds()); */
            e.timestamp = new Date(e.timestamp);
            return e;
        })
        .then(saveJSON)
}

if(!nconf.get('api'))
    throw new Error("api");

var SERVER_API_URL = nconf.get('api');
debug("API endpoint %s", SERVER_API_URL);

var bigbang = moment();
return various
    .loadJSONurl(SERVER_API_URL)
    .tap(function(urls) {
        debug("retrieved %d urls", _.size(urls));
    })
    .map(composeNEX, { concurrency: 1 })
    .then(_.compact)
    .then(_.orderBy({ publicationTime: 1 }))
    .tap(function(xxx) {
        var ranked = _.countBy(xxx, function(x) {
            return moment.duration(moment() - moment(x.publicationTime)).humanize();
        });
        debug("new urls %d, in %d seconds, this time distribution: %s", _.size(xxx),
            moment.duration(moment() - bigbang).asSeconds(), JSON.stringify(ranked, undefined, 2));
    })
    .map(dandelion, { concurrency: 1 })
    .tap(function(xxx) {
        debug("Fetched %d resources in %d seconds", _.size(xxx),
            moment.duration(moment() - bigbang).asSeconds());
    });
