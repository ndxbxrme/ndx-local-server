(function() {
  var e, module;

  module = null;

  try {
    module = angular.module('ndx');
  } catch (error) {
    e = error;
    module = angular.module('ndx', []);
  }

  module.provider('Server', function() {
    var config;
    config = {
      sharedAll: true
    };
    return {
      $get: function($http, $q, $rootElement, $window, LocalSettings, Auth, ndxdb, socket, rest) {
        var Ndx, Req, Res, autoId, checkRefresh, deleteEndpoint, deleteFn, endpoints, fetchAndUpload, fetchCount, fetchNewData, fetchNewForEndpoint, getRestrict, hasDeleted, isOnline, makeEndpointRoutes, makeRegex, makeTables, ndx, offline, original, ref, selectFn, totalFetched, uploadEndpoints, upsertFn;
        autoId = ((ref = LocalSettings.getGlobal('endpoints')) != null ? ref.autoId : void 0) || '_id';
        offline = LocalSettings.getGlobal('offline');
        endpoints = null;
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
          return !offline;
        };
        Req = function(method, uri, config, params, endpoint, restrict) {
          return {
            uri: uri,
            method: method,
            endpoint: endpoint,
            body: config || {},
            params: params,
            restrict: restrict
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
            },
            reject: function(data) {
              return defer.reject(data);
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
            i = 1;
            while (i++ < args.length - 1) {
              myroute.fns.push(args[i]);
            }
            myroute.endpoint = args[0];
            return routes[method].push(myroute);
          };
          routeRequest = function(method, uri, config) {
            var callFn, defer, ex, i, j, k, len, len1, param, params, ref1, ref2, req, res, restrict, route, testroute;
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
              restrict = getRestrict(route.endpoint);
              if (restrict.local) {
                return original['$' + method](uri, config);
              }
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
                console.log(decodeURIComponent(ex[i + 1]));
                params[param] = decodeURIComponent(ex[i + 1]);
              }
              req = Req(method, uri, config, params, route.endpoint, restrict);
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
              get: function(endpoint, route) {
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
              post: function(endpoint, route) {
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
              put: function(endpoint, route) {
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
              delete: function(endpoint, route) {
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
        getRestrict = function(tableName) {
          var key, restrict, role, tableRestrict, user;
          if (endpoints) {
            if (endpoints.restrict) {
              role = null;
              restrict = null;
              if (user = Auth.getUser()) {
                if (user.roles) {
                  for (key in user.roles) {
                    if (user.roles[key]) {
                      role = key;
                      break;
                    }
                  }
                }
              }
              tableRestrict = endpoints.restrict[tableName] || endpoints.restrict.default;
              if (tableRestrict) {
                return tableRestrict[role] || tableRestrict.default || {};
              }
            }
          }
          return {};
        };
        selectFn = function(tableName, all) {
          return function(req, res, next) {
            var myTableName, restrict, where;
            myTableName = tableName;
            restrict = req.restrict;
            if (all && restrict.all) {
              return res.json({
                total: 0,
                page: 1,
                pageSize: 0,
                items: []
              });
            }
            if (!all || !restrict.sharedAll) {
              myTableName += `_${(Auth.getUser()._id)}`;
            }
            if (all) {
              myTableName += "_all";
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
            req.body.insertedAt = req.body.insertedAt || new Date().valueOf();
            ndx.database.upsert(myTableName, req.body, where, function(err, r) {
              return res.json(err || r);
            });
            if (isOnline()) {
              return original.$post(req.uri, req.body).then(function() {
                return true;
              }, function() {
                return false;
              });
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
            ndx.app.get(endpoint, [`/api/${endpoint}`, `/api/${endpoint}/:id`], selectFn(endpoint));
            ndx.app.post(endpoint, `/api/${endpoint}/search`, selectFn(endpoint));
            ndx.app.get(endpoint, `/api/${endpoint}/:id/all`, selectFn(endpoint, true));
            ndx.app.post(endpoint, `/api/${endpoint}/search/all`, selectFn(endpoint, true));
            //ndx.app.post endpoint, "/api/#{endpoint}/modified", modifiedFn(endpoint)
            ndx.app.post(endpoint, [`/api/${endpoint}`, `/api/${endpoint}/:id`], upsertFn(endpoint));
            ndx.app.put(endpoint, [`/api/${endpoint}`, `/api/${endpoint}/:id`], upsertFn(endpoint));
            results.push(ndx.app.delete(endpoint, `/api/${endpoint}/:id`, deleteFn(endpoint)));
          }
          return results;
        };
        makeTables = function() {
          var endpoint, j, k, len, len1, myTableName, ref1, ref2, restrict, results;
          if (endpoints && endpoints.endpoints) {
            ref1 = endpoints.endpoints;
            for (j = 0, len = ref1.length; j < len; j++) {
              endpoint = ref1[j];
              myTableName = endpoint;
              restrict = getRestrict(myTableName);
              if (restrict.all || restrict.localAll) {
                continue;
              }
              if (!restrict.sharedAll) {
                myTableName += `_${(Auth.getUser()._id)}`;
              }
              myTableName += "_all";
              ndx.database.makeTable(myTableName);
            }
          }
          if (endpoints && endpoints.endpoints && Auth.getUser()) {
            ref2 = endpoints.endpoints;
            results = [];
            for (k = 0, len1 = ref2.length; k < len1; k++) {
              endpoint = ref2[k];
              restrict = getRestrict(endpoint);
              if (restrict.local) {
                continue;
              }
              results.push(ndx.database.makeTable(`${endpoint}_${(Auth.getUser()._id)}`));
            }
            return results;
          }
        };
        uploadEndpoints = function(cb) {
          if (endpoints && endpoints.endpoints && Auth.getUser()) {
            return async.each(endpoints.endpoints, function(endpoint, endpointCb) {
              var myTableName, restrict;
              restrict = getRestrict(endpoint);
              if (restrict.local) {
                return endpointCb();
              }
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
        totalFetched = 0;
        fetchNewForEndpoint = function(endpoint, all, endpointCb) {
          var PAGE_SIZE, fetchPage, localEndpoint, restrict;
          if (!Auth.getUser()) {
            return typeof endpointCb === "function" ? endpointCb() : void 0;
          }
          localEndpoint = endpoint;
          restrict = getRestrict(localEndpoint);
          if (restrict.local) {
            return typeof endpointCb === "function" ? endpointCb() : void 0;
          }
          if (all && (restrict.all || restrict.localAll)) {
            return typeof endpointCb === "function" ? endpointCb() : void 0;
          }
          if (!all || !config.sharedAll) {
            localEndpoint += `_${(Auth.getUser()._id)}`;
          }
          if (all) {
            localEndpoint += "_all";
          }
          PAGE_SIZE = 10;
          fetchPage = function(firstPage) {
            return ndx.database.maxModified(localEndpoint, function(localMaxModified) {
              var where;
              where = {
                modifiedAt: {}
              };
              if (firstPage) {
                where.modifiedAt.$gt = localMaxModified;
              } else {
                where.modifiedAt.$gte = localMaxModified;
              }
              return original.$post(`/api/${endpoint}/search${(all ? '/all' : '')}`, {
                where: where,
                sort: 'modifiedAt',
                sortDir: 'ASC',
                page: 1,
                pageSize: PAGE_SIZE
              }).then(function(modifiedDocs) {
                console.log(modifiedDocs.data.total, 'total');
                if (modifiedDocs.data && modifiedDocs.data.total) {
                  return async.each(modifiedDocs.data.items, function(modifiedDoc, upsertCb) {
                    ndx.database.upsert(localEndpoint, modifiedDoc);
                    return upsertCb();
                  }, function() {
                    var ref1;
                    totalFetched += ((ref1 = modifiedDocs.data) != null ? ref1.total : void 0) || 0;
                    if (modifiedDocs.data.total > PAGE_SIZE) {
                      return fetchPage();
                    } else {
                      return typeof endpointCb === "function" ? endpointCb() : void 0;
                    }
                  });
                } else {
                  return typeof endpointCb === "function" ? endpointCb() : void 0;
                }
              }, function() {
                return typeof endpointCb === "function" ? endpointCb() : void 0;
              });
            });
          };
          return fetchPage(true);
        };
        fetchNewData = function(cb) {
          if (endpoints && endpoints.endpoints) {
            return async.each(endpoints.endpoints, function(endpoint, endpointCb) {
              return fetchNewForEndpoint(endpoint, true, function() {
                return fetchNewForEndpoint(endpoint, false, function() {
                  return uploadEndpoints(endpointCb);
                });
              });
            }, function() {
              return typeof cb === "function" ? cb() : void 0;
            });
          }
        };
        fetchCount = 0;
        fetchAndUpload = function(data) {
          totalFetched = 0;
          if (data) {
            return fetchNewForEndpoint(data.table, true, function() {
              return fetchNewForEndpoint(data.table, false, function() {
                return uploadEndpoints(function() {
                  if (totalFetched > 0) {
                    return rest.socketRefresh(data);
                  }
                });
              });
            });
          } else {
            if (fetchCount++ > 0) {
              return fetchNewData(function() {
                if (totalFetched > 0) {
                  return rest.socketRefresh(data);
                }
              });
            }
          }
        };
        deleteEndpoint = function(endpoint, all) {
          var localEndpoint;
          localEndpoint = endpoint;
          if (!all || !config.sharedAll) {
            localEndpoint += `_${(Auth.getUser()._id)}`;
          }
          if (all) {
            localEndpoint += "_all";
          }
          return ndx.database.delete(localEndpoint);
        };
        checkRefresh = function() {
          var endpoint, lastRefresh, ref1, refreshed, results, user;
          if (endpoints && endpoints.endpoints && (user = Auth.getUser())) {
            lastRefresh = LocalSettings.getGlobal('lastRefresh') || 0;
            if (user.ndxRefresh) {
              results = [];
              for (endpoint in user.ndxRefresh) {
                refreshed = false;
                if ((lastRefresh < (ref1 = user.ndxRefresh[endpoint]) && ref1 < new Date().valueOf())) {
                  deleteEndpoint(endpoint, true);
                  deleteEndpoint(endpoint, false);
                }
                if (refreshed) {
                  results.push(LocalSettings.setGlobal('lastRefresh', new Date().valueOf()));
                } else {
                  results.push(void 0);
                }
              }
              return results;
            }
          }
        };
        $http.post = function(uri, config) {
          return ndx.app.routeRequest('post', uri, config);
        };
        $http.get = function(uri, config) {
          return ndx.app.routeRequest('get', uri, config);
        };
        $http.put = function(uri, config) {
          return ndx.app.routeRequest('put', uri, config);
        };
        $http.delete = function(uri, config) {
          return ndx.app.routeRequest('delete', uri, config);
        };
        socket.on('connect', fetchAndUpload);
        socket.on('update', fetchAndUpload);
        socket.on('insert', fetchAndUpload);
        socket.on('delete', fetchAndUpload);
        Auth.onUser(function() {
          makeTables();
          //check for refresh
          checkRefresh();
          return fetchNewData();
        });
        ndx.app.get(null, '/rest/endpoints', function(req, res, next) {
          if (isOnline()) {
            return original.$get('/rest/endpoints', req.data).then(function(response) {
              LocalSettings.setGlobal('endpoints', response.data);
              endpoints = response.data;
              console.log('endpoints', endpoints);
              makeEndpointRoutes();
              makeTables();
              checkRefresh();
              fetchAndUpload();
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
        ndx.app.post(null, '/api/refresh-login', function(req, res, next) {
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
        ndx.app.get(null, '/api/logout', function(req, res, next) {
          LocalSettings.setGlobal('loggedInUser', null);
          original.$get(req.uri, req.data).then(function() {
            return true;
          }, function() {
            return false;
          });
          return res.end('OK');
        });
        ndx.app.post(null, '/api/login', function(req, res, next) {
          return original.$post(req.uri, req.body).then(function(response) {
            return res.json(response.data);
          }, function(err) {
            var key, ref1, ref2, ref3, user, users;
            if (err.status === 401) {
              return res.reject(err);
            } else {
              users = LocalSettings.getGlobal('users');
              user = null;
              for (key in users) {
                user = users[key];
                if (((ref1 = user.local) != null ? (ref2 = ref1.email) != null ? ref2.toLowerCase() : void 0 : void 0) === ((ref3 = req.body.email) != null ? ref3.toLowerCase() : void 0)) {
                  break;
                }
              }
              if (user) {
                if (dcodeIO.bcrypt.compareSync(req.body.password, user.local.password)) {
                  LocalSettings.setGlobal('loggedInUser', {
                    user: user,
                    until: new Date().valueOf() + (5 * 60 * 60 * 1000)
                  });
                  return res.json(user);
                } else {
                  return res.reject(err);
                }
              } else {
                return res.reject(err);
              }
            }
          });
        });
        return {
          setOffline: function(val) {
            offline = val;
            return LocalSettings.setGlobal('offline', offline);
          },
          isOnline: isOnline,
          original: original,
          config: function(_config) {
            return config = _config;
          }
        };
      }
    };
  }).run(function(Server) {
    return Server.setOffline(false);
  });

}).call(this);

//# sourceMappingURL=index.js.map
