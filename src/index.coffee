module = null
try
  module = angular.module 'ndx'
catch e
  module =angular.module 'ndx', []
module.provider 'Server', ->
  config =
    sharedAll: true
  $get: ($http, $q, $rootElement, $window, LocalSettings, Auth, ndxdb, socket, rest) ->
    autoId = LocalSettings.getGlobal('endpoints')?.autoId or '_id'
    offline = LocalSettings.getGlobal('offline')
    endpoints = null
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
      not offline
    Req = (method, uri, config, params, endpoint, restrict) ->
      uri: uri
      method: method
      endpoint: endpoint
      body: config or {}
      params: params
      restrict: restrict
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
      reject: (data) ->
        defer.reject data
    Ndx = ->
      routes =
        get: []
        post: []
        put: []
        delete: []
      makeRoute = (method, route, args) ->
        myroute = makeRegex route
        i = 1
        while i++ < args.length - 1
          myroute.fns.push args[i]
        myroute.endpoint = args[0]
        routes[method].push myroute
      routeRequest = (method, uri, config) ->
        route = null
        for testroute in routes[method]
          if testroute.regex.test(uri)
            route = testroute
            break
        if route
          restrict = getRestrict route.endpoint
          if restrict.local
            return original['$' + method] uri, config
          defer = $q.defer()
          callFn = (index, req, res) ->
            if route.fns[index]
              route.fns[index] req, res, ->
                index++
                callFn index, req, res
          ex = route.regex.exec uri
          params = {}
          for param, i in route.params
            console.log decodeURIComponent(ex[i+1])
            params[param] = decodeURIComponent(ex[i+1])
          req = Req method, uri, config, params, route.endpoint, restrict
          res = Res method, uri, config, defer
          callFn 0, req, res
          return defer.promise
        else
          return original['$' + method] uri, config  
      app:
        routeRequest: routeRequest
        get: (endpoint, route) ->
          if Object.prototype.toString.call(route) is '[object Array]'
            for r in route
              makeRoute 'get', r, arguments
          else
            makeRoute 'get', route, arguments
        post: (endpoint, route) ->
          if Object.prototype.toString.call(route) is '[object Array]'
            for r in route
              makeRoute 'post', r, arguments
          else
            makeRoute 'post', route, arguments
        put: (endpoint, route) ->
          if Object.prototype.toString.call(route) is '[object Array]'
            for r in route
              makeRoute 'put', r, arguments
          else
            makeRoute 'put', route, arguments
        delete: (endpoint, route) ->
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
    getRestrict = (tableName) ->
      if endpoints
        if endpoints.restrict
          role = null
          restrict = null
          if user = Auth.getUser()
            if user.roles
              for key of user.roles
                if user.roles[key]
                  role = key
                  break
          tableRestrict = endpoints.restrict[tableName] or endpoints.restrict.default
          if tableRestrict
            return tableRestrict[role] or tableRestrict.default or {}
      return {}
    selectFn = (tableName, all) ->
      (req, res, next) ->
        myTableName = tableName
        restrict = req.restrict
        if all and restrict.all
          return res.json
            total: 0
            page: 1
            pageSize: 0
            items: []
        if not all or not restrict.sharedAll
          myTableName += "_#{Auth.getUser()._id}"
        if all
          myTableName += "_all"
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
        req.body.insertedAt = req.body.insertedAt or new Date().valueOf()
        ndx.database.upsert myTableName, req.body, where, (err, r) ->
          res.json(err or r)
        if isOnline()
          original.$post req.uri, req.body
          .then ->
            true
          , ->
            false
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
        ndx.app.get endpoint, ["/api/#{endpoint}", "/api/#{endpoint}/:id"], selectFn(endpoint)
        ndx.app.post endpoint, "/api/#{endpoint}/search", selectFn(endpoint)
        ndx.app.get endpoint, "/api/#{endpoint}/:id/all", selectFn(endpoint, true)
        ndx.app.post endpoint, "/api/#{endpoint}/search/all", selectFn(endpoint, true)
        #ndx.app.post endpoint, "/api/#{endpoint}/modified", modifiedFn(endpoint)
        ndx.app.post endpoint, ["/api/#{endpoint}", "/api/#{endpoint}/:id"], upsertFn(endpoint)
        ndx.app.put endpoint, ["/api/#{endpoint}", "/api/#{endpoint}/:id"], upsertFn(endpoint)
        ndx.app.delete endpoint, "/api/#{endpoint}/:id", deleteFn(endpoint)
    makeTables = ->
      if endpoints and endpoints.endpoints
        for endpoint in endpoints.endpoints
          myTableName = endpoint
          restrict = getRestrict myTableName
          if restrict.all or restrict.localAll
            continue
          if not restrict.sharedAll
            myTableName += "_#{Auth.getUser()._id}"
          myTableName += "_all"
          ndx.database.makeTable myTableName
      if endpoints and endpoints.endpoints and Auth.getUser()
        for endpoint in endpoints.endpoints
          restrict = getRestrict endpoint
          if restrict.local
            continue
          ndx.database.makeTable "#{endpoint}_#{Auth.getUser()._id}"
    uploadEndpoints = (cb) ->
      if endpoints and endpoints.endpoints and Auth.getUser()
        async.each endpoints.endpoints, (endpoint, endpointCb) ->
          restrict = getRestrict endpoint
          if restrict.local
            return endpointCb()
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
    totalFetched = 0
    fetchNewForEndpoint = (endpoint, all, endpointCb) ->
      if not Auth.getUser()
        return endpointCb?()
      localEndpoint = endpoint
      restrict = getRestrict localEndpoint
      if restrict.local
        return endpointCb?()
      if all and (restrict.all or restrict.localAll)
        return endpointCb?()
      if not all or not config.sharedAll
        localEndpoint += "_#{Auth.getUser()._id}"
      if all
        localEndpoint += "_all"
      PAGE_SIZE = 10
      fetchPage = (firstPage) ->
        ndx.database.maxModified localEndpoint, (localMaxModified) ->
          where =
            modifiedAt: {}
          if firstPage
            where.modifiedAt.$gt = localMaxModified
          else
            where.modifiedAt.$gte = localMaxModified
          original.$post "/api/#{endpoint}/search#{if all then '/all' else ''}",
            where: where
            sort: 'modifiedAt'
            sortDir: 'ASC'
            page: 1
            pageSize: PAGE_SIZE
          .then (modifiedDocs) ->
            console.log modifiedDocs.data.total, 'total'
            if modifiedDocs.data and modifiedDocs.data.total
              async.each modifiedDocs.data.items, (modifiedDoc, upsertCb) ->
                ndx.database.upsert localEndpoint, modifiedDoc
                upsertCb()
              , ->
                totalFetched += modifiedDocs.data?.total or 0
                if modifiedDocs.data.total > PAGE_SIZE
                  fetchPage()
                else
                  endpointCb?()
            else
              endpointCb?()
          , ->
            endpointCb?()
      fetchPage true
    fetchNewData = (cb) ->
      if endpoints and endpoints.endpoints
        async.each endpoints.endpoints, (endpoint, endpointCb) ->
          fetchNewForEndpoint endpoint, true, ->
            fetchNewForEndpoint endpoint, false, ->
              uploadEndpoints endpointCb
        , ->
          cb?()
    fetchCount = 0
    fetchAndUpload = (data) ->
      totalFetched = 0
      if data
        fetchNewForEndpoint data.table, true, ->
          fetchNewForEndpoint data.table, false, ->
            uploadEndpoints ->
              if totalFetched > 0
                rest.socketRefresh data
      else
        if fetchCount++ > 0
          fetchNewData ->
            if totalFetched > 0
              rest.socketRefresh data
    deleteEndpoint = (endpoint, all) ->
      localEndpoint = endpoint
      if not all or not config.sharedAll
        localEndpoint += "_#{Auth.getUser()._id}"
      if all
        localEndpoint += "_all"
      ndx.database.delete localEndpoint
    checkRefresh = ->
      if endpoints and endpoints.endpoints and user = Auth.getUser()
        lastRefresh = LocalSettings.getGlobal('lastRefresh') or 0
        if user.ndxRefresh
          for endpoint of user.ndxRefresh
            refreshed = false
            if lastRefresh < user.ndxRefresh[endpoint] < new Date().valueOf()
              deleteEndpoint endpoint, true
              deleteEndpoint endpoint, false
            if refreshed
              LocalSettings.setGlobal 'lastRefresh', new Date().valueOf()
    $http.post = (uri, config) ->
      ndx.app.routeRequest 'post', uri, config
    $http.get = (uri, config) ->
      ndx.app.routeRequest 'get', uri, config
    $http.put = (uri, config) ->
      ndx.app.routeRequest 'put', uri, config
    $http.delete = (uri, config) ->
      ndx.app.routeRequest 'delete', uri, config
    socket.on 'connect', fetchAndUpload
    socket.on 'update', fetchAndUpload
    socket.on 'insert', fetchAndUpload
    socket.on 'delete', fetchAndUpload
    Auth.onUser ->
      makeTables()
      #check for refresh
      checkRefresh()
      fetchNewData()
    ndx.app.get null, '/rest/endpoints', (req, res, next) ->
      if isOnline()
        original.$get '/rest/endpoints', req.data
        .then (response) ->
          LocalSettings.setGlobal 'endpoints', response.data
          endpoints = response.data
          console.log 'endpoints', endpoints
          makeEndpointRoutes()
          makeTables()
          checkRefresh()
          fetchAndUpload()
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
    ndx.app.post null, '/api/refresh-login', (req, res, next) ->
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
    ndx.app.get null, '/api/logout', (req, res, next) ->
      LocalSettings.setGlobal 'loggedInUser', null
      original.$get req.uri, req.data
      .then ->
        true
      , ->
        false
      res.end 'OK'
    ndx.app.post null, '/api/login', (req, res, next) ->
      original.$post req.uri, req.body
      .then (response) ->
        res.json response.data
      , (err) ->
        if err.status is 401
          res.reject err
        else
          users = LocalSettings.getGlobal 'users'
          user = null
          for key of users
            user = users[key]
            if user.local?.email?.toLowerCase() is req.body.email?.toLowerCase()
              break
          if user
            if dcodeIO.bcrypt.compareSync req.body.password, user.local.password
              LocalSettings.setGlobal 'loggedInUser', 
                user: user
                until: new Date().valueOf() + (5 * 60 * 60 * 1000)
              res.json user
            else
              res.reject err
          else
            res.reject err
    setOffline: (val) ->
      offline = val
      LocalSettings.setGlobal 'offline', offline
    isOnline: isOnline
    original: original
    config: (_config) ->
      config = _config
.run (Server) ->
  Server.setOffline false
