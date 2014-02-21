(function(){
    var socket = chrome.socket

    function WebApplication(opts) {
        this.opts = opts
        this.handlers = opts.handlers
        this.handlersMatch = []

        for (var i=0; i<this.handlers.length; i++) {
            var repat = this.handlers[i][0]
            this.handlersMatch.push( [new RegExp(repat), this.handlers[i][1]] )
        }

        this.host = opts.host || '127.0.0.1'
        this.port = opts.port
        this.sockInfo = null
        this.lasterr = null
    }

    WebApplication.prototype = {
        error: function(data) {
            console.error(data)
            this.lasterr = data
        },
        start: function() {
            socket.create("tcp", {}, function(sockInfo) {
                this.sockInfo = sockInfo
                socket.listen(this.sockInfo.socketId,
                              this.host,
                              this.port,
                              function(result) {
                                  if (result < 0) {
                                      this.error({message:'unable to bind to port',
                                                  errno:result})
                                  } else {
                                      console.log('listen result',result)
                                      this.doAccept()
                                  }
                              }.bind(this))
            }.bind(this));
        },
        doAccept: function() {
            socket.accept(this.sockInfo.socketId, this.onAccept.bind(this));
        },
        onAccept: function(acceptInfo) {
            //console.log('onAccept',acceptInfo);
            if (acceptInfo.socketId) {
                var stream = new IOStream(acceptInfo.socketId)
                var connection = new HTTPConnection(stream)
                connection.addRequestCallback(this.onRequest.bind(this))
                connection.tryRead()
            }
            this.doAccept()
        },
        onRequest: function(request) {
            console.log('handle req',request.uri)
            for (var i=0; i<this.handlersMatch.length; i++) {
                var re = this.handlersMatch[i][0]
                var reresult = re.exec(request.uri)
                if (reresult) {
                    var cls = this.handlersMatch[i][1]
                    var requestHandler = new cls(request)
                    requestHandler.request = request
                    requestHandler[request.method.toLowerCase()](reresult.slice(1))
                    return
                }
            }
            console.error('unhandled request',request)
            
        }
    }

    function BaseHandler() {
        this.headersWritten = false
        this.responseHeaders = {}
        this.responseData = []
        this.responseLength = null
    }
    _.extend(BaseHandler.prototype, {
        get_argument: function(key,def) {
            if (this.request.arguments[key] !== undefined) {
                return this.request.arguments[key]
            } else {
                return def
            }
        },
        setHeader: function(k,v) {
            this.responseHeaders[k] = v
        },
        writeHeaders: function(code, callback) {
            if (code === undefined) { code = 200 }
            this.headersWritten = true
            var lines = []
            if (code == 200) {
                lines.push('HTTP/1.1 200 OK')
            } else {
                lines.push('HTTP/1.1 '+ code + ' ' + HTTPRESPONSES[code])
            }
            console.assert(this.responseLength)
            lines.push('content-length: ' + this.responseLength)

            var p = this.request.path.split('.')
            if (p.length > 1) {
                var ext = p[p.length-1].toLowerCase()
                if (MIMETYPES[ext]) {
                    this.setHeader('content-type',MIMETYPES[ext])
                }
            }

            for (key in this.responseHeaders) {
                lines.push(key +': '+this.responseHeaders[key])
            }
            lines.push('\r\n')
            var headerstr = lines.join('\r\n')
            console.log('write headers',headerstr)
            this.request.connection.write(headerstr, callback)
        },
        write: function(data, code) {
            if (code === undefined) { code = 200 }
            this.responseData.push(data)
            this.responseLength += (data.length || data.byteLength)
            // todo - support chunked response?
            if (! this.headersWritten) {
                this.writeHeaders(code)
            }
            for (var i=0; i<this.responseData.length; i++) {
                this.request.connection.write(this.responseData[i])
            }
            this.responseData = []
            this.finish()
        },
        finish: function() {
            this.request.connection.curRequest = null
            if (this.request.isKeepAlive() && ! this.request.connection.stream.remoteclosed) {
                this.request.connection.tryRead()
            } else {
                this.request.connection.close()
            }
        }
    })

    function haveentry(entry) {
        window.fs = new FileSystem(entry)
    }
    window.haveentry = haveentry

    function FileSystem(entry) {
        this.entry = entry
    }
    _.extend(FileSystem.prototype, {
        getByPath: function(path, callback) {
            if (path == '/') { 
                callback(this.entry)
                return
            }
            var parts = path.split('/')
            var newpath = parts.slice(1,parts.length)
            recursiveGetEntry(this.entry, newpath, callback)
        }
    })

    window.FileSystem = FileSystem
    window.BaseHandler = BaseHandler
    chrome.WebApplication = WebApplication

})();