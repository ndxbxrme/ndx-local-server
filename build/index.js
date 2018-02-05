(function() {
  'use strict';
  var module;

  module = angular.module('ndx-server', ['ngCookies']);

  module.provider('Server', function() {
    return {
      $get: function($http, $q, $rootElement, $window, $cookies, LocalSettings, Auth, ndxdb, socket) {
        var Ndx, Req, Res, autoId, deleteFn, endpoints, fetchNewData, fetchNewForEndpoint, hasDeleted, isOnline, makeEndpointRoutes, makeRegex, makeTables, ndx, offline, original, ref, selectFn, uploadEndpoints, upsertFn;
        autoId = ((ref = LocalSettings.getGlobal('endpoints')) != null ? ref.autoId : void 0) || '_id';
        offline = LocalSettings.getGlobal('offline');
        endpoints = [];
        original = {
          $post: $http.post,
          $get: $http.get,
          $put: $http.put,
          $delete: $http.delete
        };
        makeRegex = function(str) {
          var params, regex;
          params = [];
          regex = new RegExp('^' + str.replace(/(:[^\/]+)/gi, function(all, param) {
            params.push(param.replace(':', ''));
            return '([^\/]*)';
          }) + '$');
          return {
            regex: regex,
            params: params,
            fns: []
          };
        };
        isOnline = function() {
          if (!offline) {
            return $window.navigator.onLine;
          }
          return false;
        };
        Req = function(method, uri, config, params) {
          return {
            uri: uri,
            method: method,
            body: config || {},
            params: params
          };
        };
        Res = function(method, uri, config, defer) {
          var status;
          status = 200;
          return {
            method: method,
            data: config,
            status: function(_status) {
              status = _status;
              return this;
            },
            end: function(str) {
              return defer.resolve({
                status: status,
                data: str
              });
            },
            json: function(data) {
              return defer.resolve({
                status: status,
                data: data
              });
            }
          };
        };
        Ndx = function() {
          var makeRoute, routeRequest, routes;
          routes = {
            get: [],
            post: [],
            put: [],
            delete: []
          };
          makeRoute = function(method, route, args) {
            var i, myroute;
            myroute = makeRegex(route);
            i = 0;
            while (i++ < args.length - 1) {
              myroute.fns.push(args[i]);
            }
            return routes[method].push(myroute);
          };
          routeRequest = function(method, uri, config) {
            var callFn, defer, ex, i, j, k, len, len1, param, params, ref1, ref2, req, res, route, testroute;
            route = null;
            ref1 = routes[method];
            for (j = 0, len = ref1.length; j < len; j++) {
              testroute = ref1[j];
              if (testroute.regex.test(uri)) {
                route = testroute;
                break;
              }
            }
            if (route) {
              defer = $q.defer();
              callFn = function(index, req, res) {
                if (route.fns[index]) {
                  return route.fns[index](req, res, function() {
                    index++;
                    return callFn(index, req, res);
                  });
                }
              };
              ex = route.regex.exec(uri);
              params = {};
              ref2 = route.params;
              for (i = k = 0, len1 = ref2.length; k < len1; i = ++k) {
                param = ref2[i];
                params[param] = ex[i + 1];
              }
              req = Req(method, uri, config, params);
              res = Res(method, uri, config, defer);
              callFn(0, req, res);
              return defer.promise;
            } else {
              return original['$' + method](uri, config);
            }
          };
          return {
            app: {
              routeRequest: routeRequest,
              get: function(route) {
                var j, len, r, results;
                if (Object.prototype.toString.call(route) === '[object Array]') {
                  results = [];
                  for (j = 0, len = route.length; j < len; j++) {
                    r = route[j];
                    results.push(makeRoute('get', r, arguments));
                  }
                  return results;
                } else {
                  return makeRoute('get', route, arguments);
                }
              },
              post: function(route) {
                var j, len, r, results;
                if (Object.prototype.toString.call(route) === '[object Array]') {
                  results = [];
                  for (j = 0, len = route.length; j < len; j++) {
                    r = route[j];
                    results.push(makeRoute('post', r, arguments));
                  }
                  return results;
                } else {
                  return makeRoute('post', route, arguments);
                }
              },
              put: function(route) {
                var j, len, r, results;
                if (Object.prototype.toString.call(route) === '[object Array]') {
                  results = [];
                  for (j = 0, len = route.length; j < len; j++) {
                    r = route[j];
                    results.push(makeRoute('put', r, arguments));
                  }
                  return results;
                } else {
                  return makeRoute('put', route, arguments);
                }
              },
              delete: function(route) {
                var j, len, r, results;
                if (Object.prototype.toString.call(route) === '[object Array]') {
                  results = [];
                  for (j = 0, len = route.length; j < len; j++) {
                    r = route[j];
                    results.push(makeRoute('delete', r, arguments));
                  }
                  return results;
                } else {
                  return makeRoute('delete', route, arguments);
                }
              }
            },
            database: ndxdb,
            settings: {
              AUTO_ID: autoId,
              SOFT_DELETE: true
            }
          };
        };
        ndx = Ndx();
        //# REST FUNCTIONS
        hasDeleted = function(obj) {
          var key, truth;
          truth = false;
          if (typeof obj === 'object') {
            for (key in obj) {
              if (key === 'deleted') {
                return true;
              } else {
                if (truth = hasDeleted(obj[key])) {
                  return true;
                }
              }
            }
          }
          return truth;
        };
        selectFn = function(tableName, all) {
          return function(req, res, next) {
            var myTableName, where;
            myTableName = tableName;
            if (!all) {
              myTableName += `_${(Auth.getUser()._id)}`;
            }
            if (req.params && req.params.id) {
              where = {};
              if (req.params.id.indexOf('{') === 0) {
                where = JSON.parse(req.params.id);
              } else {
                where[ndx.settings.AUTO_ID] = req.params.id;
              }
              if (ndx.settings.SOFT_DELETE && !req.body.showDeleted && !hasDeleted(where)) {
                where.deleted = null;
              }
              if (all) {
                elevateUser(ndx.user);
              }
              return ndx.database.select(myTableName, {
                where: where
              }, function(items) {
                if (items && items.length) {
                  return res.json(items[0]);
                } else {
                  return res.json({});
                }
              });
            } else {
              req.body.where = req.body.where || {};
              if (ndx.settings.SOFT_DELETE && !req.body.showDeleted && !hasDeleted(req.body.where)) {
                req.body.where.deleted = null;
              }
              if (req.body.all || all) {
                elevateUser(ndx.user);
              }
              return ndx.database.select(myTableName, req.body, function(items, total) {
                return res.json({
                  total: total,
                  page: req.body.page || 1,
                  pageSize: req.body.pageSize || 0,
                  items: items
                });
              });
            }
          };
        };
        upsertFn = function(tableName) {
          return function(req, res, next) {
            var myTableName, op, where;
            myTableName = `${tableName}_${(Auth.getUser()._id)}`;
            op = req.params.id ? 'update' : 'insert';
            where = {};
            if (req.params.id) {
              where[ndx.settings.AUTO_ID] = req.params.id;
            }
            req.body.modifiedAt = 0;
            ndx.database.upsert(myTableName, req.body, where, function(err, r) {
              return res.json(err || r);
            });
            if (isOnline()) {
              return original.$post(req.uri, req.body);
            }
          };
        };
        deleteFn = function(tableName) {
          return function(req, res, next) {
            var myTableName, where;
            myTableName = `${tableName}_${(Auth.getUser()._id)}`;
            if (req.params.id) {
              where = {};
              where[ndx.settings.AUTO_ID] = req.params.id;
              if (ndx.settings.SOFT_DELETE) {
                ndx.database.update(tableName, {
                  deleted: {
                    by: ndx.user[ndx.settings.AUTO_ID],
                    at: new Date().valueOf()
                  },
                  modifiedAt: 0
                }, where);
              } else {
                ndx.database.delete(myTableName, where);
              }
            }
            if (isOnline()) {
              original.$delete(req.uri);
            }
            return res.end('OK');
          };
        };
        makeEndpointRoutes = function() {
          var endpoint, j, len, ref1, results;
          ref1 = endpoints.endpoints;
          results = [];
          for (j = 0, len = ref1.length; j < len; j++) {
            endpoint = ref1[j];
            ndx.app.get([`/api/${endpoint}`, `/api/${endpoint}/:id`], selectFn(endpoint));
            ndx.app.get(`/api/${endpoint}/:id/all`, selectFn(endpoint, true));
            ndx.app.post(`/api/${endpoint}/search`, selectFn(endpoint));
            //ndx.app.post "/api/#{endpoint}/modified", modifiedFn(endpoint)
            ndx.app.post([`/api/${endpoint}`, `/api/${endpoint}/:id`], upsertFn(endpoint));
            ndx.app.put([`/api/${endpoint}`, `/api/${endpoint}/:id`], upsertFn(endpoint));
            results.push(ndx.app.delete(`/api/${endpoint}/:id`, deleteFn(endpoint)));
          }
          return results;
        };
        makeTables = function() {
          var endpoint, j, k, len, len1, ref1, ref2, results;
          if (endpoints && endpoints.endpoints) {
            ref1 = endpoints.endpoints;
            for (j = 0, len = ref1.length; j < len; j++) {
              endpoint = ref1[j];
              ndx.database.makeTable(endpoint);
            }
          }
          if (endpoints && endpoints.endpoints && Auth.getUser()) {
            ref2 = endpoints.endpoints;
            results = [];
            for (k = 0, len1 = ref2.length; k < len1; k++) {
              endpoint = ref2[k];
              results.push(ndx.database.makeTable(`${endpoint}_${(Auth.getUser()._id)}`));
            }
            return results;
          }
        };
        uploadEndpoints = function(cb) {
          if (endpoints && endpoints.endpoints && Auth.getUser()) {
            return async.each(endpoints.endpoints, function(endpoint, endpointCb) {
              var myTableName;
              myTableName = `${endpoint}_${(Auth.getUser()._id)}`;
              return ndx.database.getDocsToUpload(myTableName, function(docs) {
                if (docs) {
                  return async.each(docs, function(doc, docCb) {
                    return original.$post(`/api/${endpoint}`, doc);
                  }, function() {
                    return endpointCb();
                  });
                } else {
                  return endpointCb();
                }
              });
            }, function() {
              return typeof cb === "function" ? cb() : void 0;
            });
          }
        };
        fetchNewForEndpoint = function(endpoint, all, endpointCb) {
          var localEndpoint;
          localEndpoint = endpoint;
          if (!all) {
            if (!Auth.getUser()) {
              return typeof endpointCb === "function" ? endpointCb() : void 0;
            }
            localEndpoint = `${endpoint}_${(Auth.getUser()._id)}`;
          }
          return ndx.database.maxModified(localEndpoint, function(localMaxModified) {
            return original.$post(`/api/${endpoint}/search${(all ? '/all' : '')}`, {
              where: {
                modifiedAt: {
                  $gt: localMaxModified
                }
              }
            }).then(function(modifiedDocs) {
              if (modifiedDocs.data && modifiedDocs.data.total) {
                return async.each(modifiedDocs.data.items, function(modifiedDoc, upsertCb) {
                  ndx.database.upsert(localEndpoint, modifiedDoc);
                  return upsertCb();
                }, function() {
                  return typeof endpointCb === "function" ? endpointCb() : void 0;
                });
              } else {
                return typeof endpointCb === "function" ? endpointCb() : void 0;
              }
            }, function() {
              return typeof endpointCb === "function" ? endpointCb() : void 0;
            });
          });
        };
        fetchNewData = function() {
          if (endpoints && endpoints.endpoints) {
            return async.each(endpoints.endpoints, function(endpoint, endpointCb) {
              return fetchNewForEndpoint(endpoint, true, function() {
                return fetchNewForEndpoint(endpoint, false, function() {
                  return uploadEndpoints(endpointCb);
                });
              });
            }, function() {
              return true;
            });
          }
        };
        $http.post = function(uri, config) {
          //console.log 'post', uri, config
          return ndx.app.routeRequest('post', uri, config);
        };
        $http.get = function(uri, config) {
          //console.log 'get', uri
          return ndx.app.routeRequest('get', uri, config);
        };
        $http.put = function(uri, config) {
          return ndx.app.routeRequest('put', uri, config);
        };
        $http.delete = function(uri, config) {
          return ndx.app.routeRequest('delete', uri, config);
        };
        socket.on('connect', function() {
          return uploadEndpoints();
        });
        socket.on('update', function(data) {
          return fetchNewForEndpoint(data.table, true, function() {
            return fetchNewForEndpoint(data.table, false, function() {
              return uploadEndpoints();
            });
          });
        });
        socket.on('insert', function(data) {
          return fetchNewForEndpoint(data.table, true, function() {
            return fetchNewForEndpoint(data.table, false, function() {
              return uploadEndpoints();
            });
          });
        });
        socket.on('delete', function(data) {
          return fetchNewForEndpoint(data.table, true, function() {
            return fetchNewForEndpoint(data.table, false, function() {
              return uploadEndpoints();
            });
          });
        });
        Auth.onUser(function() {
          makeTables();
          return fetchNewData();
        });
        ndx.app.get('/rest/endpoints', function(req, res, next) {
          if (isOnline()) {
            return original.$get('/rest/endpoints', req.data).then(function(response) {
              LocalSettings.setGlobal('endpoints', response.data);
              endpoints = response.data;
              makeEndpointRoutes();
              makeTables();
              fetchNewData();
              return res.json(response.data);
            }, function() {
              endpoints = LocalSettings.getGlobal('endpoints');
              if (endpoints) {
                makeEndpointRoutes();
                makeTables();
                return res.json(endpoints);
              } else {
                return res.json({});
              }
            });
          } else {
            endpoints = LocalSettings.getGlobal('endpoints');
            makeEndpointRoutes();
            makeTables();
            return res.json(endpoints);
          }
        });
        ndx.app.post('/api/refresh-login', function(req, res, next) {
          var loggedInUser;
          if (isOnline()) {
            return original.$post('/api/refresh-login', req.data).then(function(response) {
              var globalUsers;
              if (response.status === 200) {
                globalUsers = LocalSettings.getGlobal('users') || {};
                globalUsers[response.data[autoId]] = response.data;
                LocalSettings.setGlobal('users', globalUsers);
                LocalSettings.setGlobal('loggedInUser', {
                  user: response.data,
                  until: new Date().valueOf() + (5 * 60 * 60 * 1000)
                });
                return res.json(response.data);
              } else {
                return res.status(response.status).json(response.data);
              }
            }, function() {
              var loggedInUser;
              loggedInUser = LocalSettings.getGlobal('loggedInUser');
              if (loggedInUser && loggedInUser.until && loggedInUser.until > new Date().valueOf()) {
                loggedInUser.until = new Date().valueOf() + (5 * 60 * 60 * 1000);
                LocalSettings.setGlobal('loggedInUser', loggedInUser);
                return res.json(loggedInUser.user);
              } else {
                return res.status(401).json({});
              }
            });
          } else {
            loggedInUser = LocalSettings.getGlobal('loggedInUser');
            if (loggedInUser && loggedInUser.until && loggedInUser.until > new Date().valueOf()) {
              loggedInUser.until = new Date().valueOf() + (5 * 60 * 60 * 1000);
              LocalSettings.setGlobal('loggedInUser', loggedInUser);
              return res.json(loggedInUser.user);
            } else {
              return res.status(401).json({});
            }
          }
        });
        return {
          setOffline: function(val) {
            offline = val;
            return LocalSettings.setGlobal('offline', offline);
          },
          isOnline: isOnline,
          original: original
        };
      }
    };
  }).run(function(Server) {
    return Server.setOffline(false);
  });

}).call(this);

//# sourceMappingURL=index.js.map
