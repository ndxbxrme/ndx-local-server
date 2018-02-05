'use strict'
module = angular.module 'ndx-server', ['ngCookies']
module.provider 'Server', ->
  $get: ($http, $q, $rootElement, $window, $cookies, LocalSettings, Auth, ndxdb, socket) ->
    autoId = LocalSettings.getGlobal('endpoints')?.autoId or '_id'
    offline = LocalSettings.getGlobal('offline')
    endpoints = []
    original =
      $post: $http.post
      $get: $http.get
      $put: $http.put
      $delete: $http.delete
    makeRegex = (str) ->
      params = []
      regex = new RegExp '^' + str.replace(/(:[^\/]+)/gi, (all, param) ->
        params.push param.replace(':', '')
        '([^\/]*)'
      ) + '$'
      return
        regex: regex
        params: params
        fns: []
    isOnline = ->
      if not offline
        return $window.navigator.onLine
      false
    Req = (method, uri, config, params) ->
      uri: uri
      method: method
      body: config or {}
      params: params
    Res = (method, uri, config, defer) ->
      status = 200
      method: method
      data: config
      status: (_status) ->
        status = _status
        @
      end: (str) ->
        defer.resolve
          status: status
          data: str
      json: (data) ->
        defer.resolve
          status: status
          data: data
    Ndx = ->
      routes =
        get: []
        post: []
        put: []
        delete: []
      makeRoute = (method, route, args) ->
        myroute = makeRegex route
        i = 0
        while i++ < args.length - 1
          myroute.fns.push args[i]
        routes[method].push myroute
      routeRequest = (method, uri, config) ->
        route = null
        for testroute in routes[method]
          if testroute.regex.test(uri)
            route = testroute
            break
        if route
          defer = $q.defer()
          callFn = (index, req, res) ->
            if route.fns[index]
              route.fns[index] req, res, ->
                index++
                callFn index, req, res
          ex = route.regex.exec uri
          params = {}
          for param, i in route.params
            params[param] = ex[i+1]
          req = Req method, uri, config, params
          res = Res method, uri, config, defer
          callFn 0, req, res
          return defer.promise
        else
          return original['$' + method] uri, config  
      app:
        routeRequest: routeRequest
        get: (route) ->
          if Object.prototype.toString.call(route) is '[object Array]'
            for r in route
              makeRoute 'get', r, arguments
          else
            makeRoute 'get', route, arguments
        post: (route) ->
          if Object.prototype.toString.call(route) is '[object Array]'
            for r in route
              makeRoute 'post', r, arguments
          else
            makeRoute 'post', route, arguments
        put: (route) ->
          if Object.prototype.toString.call(route) is '[object Array]'
            for r in route
              makeRoute 'put', r, arguments
          else
            makeRoute 'put', route, arguments
        delete: (route) ->
          if Object.prototype.toString.call(route) is '[object Array]'
            for r in route
              makeRoute 'delete', r, arguments
          else
            makeRoute 'delete', route, arguments
      database: ndxdb
      settings:
        AUTO_ID: autoId
        SOFT_DELETE: true
    ndx = Ndx()
    ## REST FUNCTIONS
    hasDeleted = (obj) ->
      truth = false
      if typeof(obj) is 'object'
        for key of obj
          if key is 'deleted'
            return true
          else
            if truth = hasDeleted obj[key]
              return true
      truth
    selectFn = (tableName, all) ->
      (req, res, next) ->
        myTableName = tableName
        if not all
          myTableName += "_#{Auth.getUser()._id}"
        if req.params and req.params.id
          where = {}
          if req.params.id.indexOf('{') is 0
            where = JSON.parse req.params.id
          else
            where[ndx.settings.AUTO_ID] = req.params.id
          if ndx.settings.SOFT_DELETE and not req.body.showDeleted and not hasDeleted(where)
            where.deleted = null
          if all
            elevateUser ndx.user
          ndx.database.select myTableName, 
            where: where
          , (items) ->
            if items and items.length
              res.json items[0]
            else
              res.json {}
        else
          req.body.where = req.body.where or {}
          if ndx.settings.SOFT_DELETE and not req.body.showDeleted and not hasDeleted(req.body.where)
            req.body.where.deleted = null
          if req.body.all or all
            elevateUser ndx.user
          ndx.database.select myTableName, req.body, (items, total) ->
            res.json
              total: total
              page: req.body.page or 1
              pageSize: req.body.pageSize or 0
              items: items
    upsertFn = (tableName) ->
      (req, res, next) ->
        myTableName = "#{tableName}_#{Auth.getUser()._id}"
        op = if req.params.id then 'update' else 'insert'
        where = {}
        if req.params.id
          where[ndx.settings.AUTO_ID] = req.params.id
        req.body.modifiedAt = 0
        ndx.database.upsert myTableName, req.body, where, (err, r) ->
          res.json(err or r)
        if isOnline()
          original.$post req.uri, req.body
    deleteFn = (tableName) ->
      (req, res, next) ->
        myTableName = "#{tableName}_#{Auth.getUser()._id}"
        if req.params.id
          where = {}
          where[ndx.settings.AUTO_ID] = req.params.id
          if ndx.settings.SOFT_DELETE
            ndx.database.update tableName, 
              deleted:
                by:ndx.user[ndx.settings.AUTO_ID]
                at:new Date().valueOf()
              modifiedAt: 0
            , where
          else
            ndx.database.delete myTableName, where
        if isOnline()
          original.$delete req.uri
        res.end 'OK'
    makeEndpointRoutes = ->
      for endpoint in endpoints.endpoints
        ndx.app.get ["/api/#{endpoint}", "/api/#{endpoint}/:id"], selectFn(endpoint)
        ndx.app.get "/api/#{endpoint}/:id/all", selectFn(endpoint, true)
        ndx.app.post "/api/#{endpoint}/search", selectFn(endpoint)
        #ndx.app.post "/api/#{endpoint}/modified", modifiedFn(endpoint)
        ndx.app.post ["/api/#{endpoint}", "/api/#{endpoint}/:id"], upsertFn(endpoint)
        ndx.app.put ["/api/#{endpoint}", "/api/#{endpoint}/:id"], upsertFn(endpoint)
        ndx.app.delete "/api/#{endpoint}/:id", deleteFn(endpoint)
    makeTables = ->
      if endpoints and endpoints.endpoints
        for endpoint in endpoints.endpoints
          ndx.database.makeTable endpoint
      if endpoints and endpoints.endpoints and Auth.getUser()
        for endpoint in endpoints.endpoints
          ndx.database.makeTable "#{endpoint}_#{Auth.getUser()._id}"
    uploadEndpoints = (cb) ->
      if endpoints and endpoints.endpoints and Auth.getUser()
        async.each endpoints.endpoints, (endpoint, endpointCb) ->
          myTableName = "#{endpoint}_#{Auth.getUser()._id}"
          ndx.database.getDocsToUpload myTableName, (docs) ->
            if docs
              async.each docs, (doc, docCb) ->
                original.$post "/api/#{endpoint}", doc
              , ->
                endpointCb()
            else
              endpointCb()
        , ->
          cb?()
    fetchNewForEndpoint = (endpoint, all, endpointCb) ->
      localEndpoint = endpoint
      if not all
        if not Auth.getUser()
          return endpointCb?()
        localEndpoint = "#{endpoint}_#{Auth.getUser()._id}"
      ndx.database.maxModified localEndpoint, (localMaxModified) ->
        original.$post "/api/#{endpoint}/search#{if all then '/all' else ''}",
          where:
            modifiedAt:
              $gt: localMaxModified
        .then (modifiedDocs) ->
          if modifiedDocs.data and modifiedDocs.data.total
            async.each modifiedDocs.data.items, (modifiedDoc, upsertCb) ->
              ndx.database.upsert localEndpoint, modifiedDoc
              upsertCb()
            , ->
              endpointCb?()
          else
            endpointCb?()
        , ->
          endpointCb?()
    fetchNewData = ->
      if endpoints and endpoints.endpoints
        async.each endpoints.endpoints, (endpoint, endpointCb) ->
          fetchNewForEndpoint endpoint, true, ->
            fetchNewForEndpoint endpoint, false, ->
              uploadEndpoints endpointCb
        , ->
          true
    $http.post = (uri, config) ->
      #console.log 'post', uri, config
      ndx.app.routeRequest 'post', uri, config
    $http.get = (uri, config) ->
      #console.log 'get', uri
      ndx.app.routeRequest 'get', uri, config
    $http.put = (uri, config) ->
      ndx.app.routeRequest 'put', uri, config
    $http.delete = (uri, config) ->
      ndx.app.routeRequest 'delete', uri, config
    socket.on 'connect', ->
      uploadEndpoints()
    socket.on 'update', (data) ->
      fetchNewForEndpoint data.table, true, ->
        fetchNewForEndpoint data.table, false, ->
          uploadEndpoints()
    socket.on 'insert', (data) ->
      fetchNewForEndpoint data.table, true, ->
        fetchNewForEndpoint data.table, false, ->
          uploadEndpoints()
    socket.on 'delete', (data) ->
      fetchNewForEndpoint data.table, true, ->
        fetchNewForEndpoint data.table, false, ->
          uploadEndpoints()
    Auth.onUser ->
      makeTables()
      fetchNewData()
    ndx.app.get '/rest/endpoints', (req, res, next) ->
      if isOnline()
        original.$get '/rest/endpoints', req.data
        .then (response) ->
          LocalSettings.setGlobal 'endpoints', response.data
          endpoints = response.data
          makeEndpointRoutes()
          makeTables()
          fetchNewData()
          res.json response.data
        , ->
          endpoints = LocalSettings.getGlobal 'endpoints'
          if endpoints
            makeEndpointRoutes()
            makeTables()
            res.json endpoints
          else
            res.json {}
      else
        endpoints = LocalSettings.getGlobal 'endpoints'
        makeEndpointRoutes()
        makeTables()
        res.json endpoints
    ndx.app.post '/api/refresh-login', (req, res, next) ->
      if isOnline()
        original.$post '/api/refresh-login', req.data
        .then (response) ->
          if response.status is 200
            globalUsers = LocalSettings.getGlobal('users') or {}
            globalUsers[response.data[autoId]] = response.data
            LocalSettings.setGlobal 'users', globalUsers
            LocalSettings.setGlobal 'loggedInUser',
              user: response.data
              until: new Date().valueOf() + (5 * 60 * 60 * 1000)
            res.json response.data
          else
            res.status(response.status).json response.data
        , ->
          loggedInUser = LocalSettings.getGlobal 'loggedInUser'
          if loggedInUser and loggedInUser.until and loggedInUser.until > new Date().valueOf()
            loggedInUser.until = new Date().valueOf() + (5 * 60 * 60 * 1000)
            LocalSettings.setGlobal 'loggedInUser', loggedInUser
            res.json loggedInUser.user
          else
            res.status(401).json {}
      else
        loggedInUser = LocalSettings.getGlobal 'loggedInUser'
        if loggedInUser and loggedInUser.until and loggedInUser.until > new Date().valueOf()
          loggedInUser.until = new Date().valueOf() + (5 * 60 * 60 * 1000)
          LocalSettings.setGlobal 'loggedInUser', loggedInUser
          res.json loggedInUser.user
        else
          res.status(401).json {}
    setOffline: (val) ->
      offline = val
      LocalSettings.setGlobal 'offline', offline
    isOnline: isOnline
    original: original
.run (Server) ->
  Server.setOffline false
