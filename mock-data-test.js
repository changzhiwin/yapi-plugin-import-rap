// https://yapi.baidu.com/doc/openapi.html
const urlUtil = require('url');
const axios = require('axios');
const testData = require('./rap-data.json');
const utils = require('./function-test.js')

const token = "d556c4e467d96e526c2e92184063748e38a5814a6fc208366aefc12bb78608fe";
const project_id = "92";

/*
{
  data: {
    modules: [
      {
        interfaces: [
          "name": "根据userId获取用户人工，机器会话历史",
          "url": "/yi-connect/v2/session/getSessionsByUserID",
          "method": "POST",
          "description": "根据userId获取用户人工，机器会话历史---张蒙蒙",
          "properties": [
            {
              "scope": "request",
              "type": "Number",
              "pos": 2,
              "name": "appID",
              "value": "10041",
              "description": "业务库ID（必传）",
              "parentId": -1,
              "required": false
            }
          ]
        ]
      }
    ]
  }
}
*/

async function creatInterface(data) {

  data = Object.assign( {
    "token": token,
    "project_id": project_id
  }, data);

 let res = await axios({
    method: 'post',
    url: 'http://172.16.30.75:3000/api/interface/add',
    headers: {
      contentType: 'application/json',
    },
    data
  });

  //console.log('interface res ====')
  //console.log(res.data)

  return res.data
}

// 新增一个分类 {desc, name, token}
async function createCat(data) {

  data = Object.assign({
    "token": token,
    "project_id": project_id,
  }, data)

  let res = await axios({
    method: 'post',
    url: 'http://172.16.30.75:3000/api/interface/add_cat',
    headers: {
      contentType: 'application/x-www-form-urlencoded',
    },
    data
  });

  //console.log('cat res ====')
  //console.log(res.data)

  return res.data
}

/*
testData.data.modules[0].interfaces.forEach((ifs) => {
  console.log(ifs.name, ifs.url, ifs.properties.length)

  if ( ifs.url.startsWith('/test/abc') )
  {
    let jsonData = utils.changeInterfaceFromRap2Yapi(ifs);
    creatInterface(jsonData)

  }
})
let ret = createCat({desc: "我测试", name: "我是开发"})
console.log(ret.data)
*/

async function main(){

  let have = 0;
  let finish = 0;
  let repeatFail = 0;
  let otherFail = 0;

  for (let t = 0; t < testData.data.modules.length; t++) {

    let md = testData.data.modules[t]
    let {description, name} = md
  
    // 新增分类，cat.data = {_id, project_id}
    let cat = await createCat({desc: description, name})

    if (cat.errcode !== 0) {
      throw new Error(`create Cat error, [${cat.errcode}] [${cat.errmsg}]`)
    }

    let catId = cat.data._id

    for (let i = 0; i < md.interfaces.length; i++) {

      let ifs = md.interfaces[i]
      let path = ifs.url || "/default_path_from_rap2"

      // 处理url中的 /%20 中文字符
      path = path.replace(/\*/g, "-") // 有*号的处理，case: /admin/*
      path = path.replace("/%20", "") // case: /%20/api/category
      path = path.replace("%20", " ") // case: /api/markQT/finish-mark%20(浦发定制化)
      path = path.trim()
      path = path.replace(/[( | （]/g, " ") // case: /api/sessionLog/export(光大定制化)

      let tempPath = path.split(" ") // case: /api/overview/exportOverviewDaterange (benchi232)
      if (tempPath.length > 1) { // 分成两个部分，才需要舍弃
        path = (tempPath[0].indexOf('/') != -1) ? (tempPath[0]) : (tempPath[1])
      }

      path = path.replace(/[^\x00-\xff]/g, "") // 去掉汉字 case: /【mq】路由分配对应内容  case: /【定制化】/api/faqMine/
      path = path.replace(/\/\//g, "/")
      path = path.trim() || "/default_path_from_rap2"
      
      
      // 处理url非标情况
      let purl = urlUtil.parse(path)
      if (!purl.pathname.startsWith('/')){
        purl.pathname = '/' + purl.pathname
      }

      // 偷懒处理重复api的情况，path加上一个随机数，万分之一的概率还是重复了，那就忍了吧
      let random = Math.ceil(Math.random() * 10000)
      path = purl.pathname + ( (purl.search)?(`${purl.search}&random=${random}`):(`?random=${random}`) )

      console.log(`[${md.name}], [${ifs.name}], [${ifs.url}], [${path}] [${ifs.properties.length}]`)

      // url万一改错了，备份到备注里面
      ifs.description = `迁移前url地址：[${ifs.url}]。为了兼容，之前存在的重复api定义，在path上添加了一个随机参数：random=${random}。 ${ifs.description}`
      ifs.url = path;

      // 新增接口
      let jsonData = utils.changeInterfaceFromRap2Yapi(ifs);
      let retIfs = await creatInterface(Object.assign(jsonData, {
        "catid": catId
      }))

      have++
      if (!retIfs.errcode) {
        finish++
      } else{
        if (40022 === retIfs.errcode) {
          repeatFail++
        }else {
          otherFail++
        }
        console.error(`xxxxxxxxxx [${md.name}], [${ifs.name}] [${ifs.url}] [${retIfs.errcode}] [${retIfs.errmsg}]`)
      }

    }
  }

  return {have, finish, otherFail, repeatFail}
}

main().then((ret) =>  {
  console.log('----------------')
  console.log(ret)
})
