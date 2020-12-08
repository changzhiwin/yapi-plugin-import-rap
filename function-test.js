const urlUtil = require('url');

const typeMapping = {
  "String": 'string',
  "Number": 'number',
  "Object": 'object',
  "Array": 'array',
  "RegExp": 'undefined',
  "Function": 'undefined',
  "Boolean": 'boolean'
}

// 修正一下number的类型，如肯定是integer的类型，则改
function hackNumberType(target) {
  if (target.type === 'number') {
    target.default = Number(target.default)

    if ( /^[0-9]+$/.test(target.default) ) {
      target.type = 'integer'
    }
  }
}

// 对于array，需要填充的是items这个属性
// rap2 处理array子元素很奇葩，array下面的子元素省略了外面包裹的object
function findArraySub(pid, arr, target) {
  // 理论上数组下面直接子节点，只会有一个，也就是统一类型的数组，不能多个类型
  let subs = arr.filter( it => it.parentId === pid );

  if (subs.length === 0) {
    // console.error(`数组的子节点异常， parentId = ${pid}, 长度是 ${subs.length}"`)
    return ;
  }

  let childId = null;
  // 处理rap2奇葩的array子元素定义：生成一个object类型的items节点来包裹
  if (subs.length > 1) {
    target.items = {
      type: 'object',
      description: 'rap2 迁移，占位object'
    }

    childId = pid; // 重新在找一遍子节点

  } else {
    let item = subs[0];
    target.items = {
      type: typeMapping[ item.type ],
      description: item.description || "",
      default: item.value || ""
    }

    childId = item.id;
  }

  switch( target.items.type ) {
    case "object":
      // yapi不显示object类型的default值，如果rap里面填了默认值，则使用description
      if (target.items.default) {
        target.items.description = [target.items.description, target.items.default].join("；")
      }
      findObjectSub(childId, arr, target.items)
      break;
    case "array":
      findArraySub(childId, arr, target.items)
      break;
  }

}

// 给一个id，找出这一层的属性
// 每一层只关心两个属性：required, properties，把这两个属性填充好就行
function findObjectSub(pid, arr, target) {
  let subs = arr.filter( it => it.parentId === pid );
  let required = [];
  let properties = {}
  
  subs.forEach((it) => {

      if (it.required) {
        required.push(it.name) //搜集必须项
      }

      properties[it.name] = {
        required: it.required,
        type: typeMapping[ it.type ],
        description: it.description || "",
        default: it.value || ""
      }

      hackNumberType(properties[it.name])

      switch( properties[it.name].type ) {
        case "object":
          // yapi不显示object类型的default值，使用description
          if (properties[it.name].default) {
            properties[it.name].description = [properties[it.name].description, properties[it.name].default].join("；")
          }
          findObjectSub(it.id, arr, properties[it.name])
          break;
        case "array":
          findArraySub(it.id, arr, properties[it.name])
          break;
      }

  })

  target["required"] = required;
  target["properties"] = properties;
}

// rap2返回的数据是打平了的，需要重新构建成json结构
// 请求为json类型时、以及响应都需要这么处理
// fileds里面会存在多个parentId=-1的情况，每个-1代表第一层根节点
function arrayToJson(fileds) {
  let data = { 
    "type":"object",
    "title":"empty object"
    /*,
    "properties":{
      "user":{"type":"string","description":"abc"}
    },
    "required":["user"]
    */
  }

  findObjectSub(-1, fileds, data);

  return data;
}


function fromRequestData(request) {
  // 根据pos(1/2/3)不同区分三类
  let header = [], query = [], body = [];

  request.forEach( (it) => {
    let temp = (it.pos === 1) ? header : ( (it.pos === 2) ? query : body);
    temp.push(it);
  })

  //header的结构: [ {"required","name", "value", "example", "desc"} ]
  //query的结构: [ {"required","name","example","desc"} ]
  //body的结构: {type: "object", title, properties: { key: {type, default, description, }, required: []}}

  // 对于header、query在yapi里面是没有类型区分的，都是字符串
  let req_headers = [], req_query = [], req_body_other = null;
  header.forEach((item) => {
    req_headers.push({
      required: "1", // yapi对于头都是必须的
      name: item.name,
      value: item.value || "",
      desc: item.description || "",
      example: ''
    })
  })

  query.forEach((item) => {
    req_query.push({
      required: item.required ? "1" : "0",
      name: item.name,
      desc: item.description || "",
      example: item.value || ""
    })
  })

  req_body_other = JSON.stringify( arrayToJson(body) )

  return {
    req_headers,
    req_query,
    req_body_other
  }

}

function fromResponseData(response) {
  return arrayToJson(response);
}

/**
 * 输入：Rap的interfaces[i] = {name, url, method, description, properties [ {type, pos, name, value, description, parentId, required} ]}
 * 输出：Yapi新增一个接口需要的data
 */
function changeInterfaceFromRap2Yapi(rapData) {
  let {name, url, method, description, properties} = rapData;

  let request = [], response = [];
  // 分别取出请求、响应参数
  properties.forEach( (pp) => {
    let temp = (pp.scope === "request") ? request: response;
    temp.push(pp);
  })

  let urlParam = urlUtil.parse(url, true)

  return Object.assign({
    method,
    title: name,
    path: url,
    desc: description,

    status: "undone",
    type: "static",

    req_body_is_json_schema: true,
    res_body_is_json_schema: true,
    api_opened: false,
    tag: [],

    query_path: {
      path: urlParam.pathname,
      params: Object.keys(urlParam.query).map((k) => { return {name: k, value: urlParam.query[k]} })
    }, //need url parse

    req_body_type: "json", // json(使用req_body_other),form,raw(使用req_body_other),file(使用req_body_other)
    // req_body_other: "",
    req_params: [], // 留空即可
    // req_query: [], //need process
    // req_headers: [], //need process
    req_body_form: [],
    
    res_body_type: "json",
    res_body: JSON.stringify( fromResponseData(response) ) , //json stringify
    
  }, fromRequestData(request));

  // return fromRequestData(request);
}

exports.changeInterfaceFromRap2Yapi = changeInterfaceFromRap2Yapi;