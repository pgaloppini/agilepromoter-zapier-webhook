var express = require('express');
var app = express();

// create http request client to consume the QPX API
var request = require("request");
var syncRequest = require('sync-request');

const PropertiesReader = require('properties-reader');
const prop = PropertiesReader('app.properties');
getProperty = (pty) => { return prop.get(pty); }
getAppProperty = (propertyName) => {
  if (process.env[propertyName] == null || process.env[propertyName] == undefined) {
    return getProperty(propertyName);
  }
  return process.env[propertyName];
}

//Seta variaveis do app - utilizando propriedades de ambiente
var enviromnentId = getAppProperty("ENVIRONMENT_ID");
var formId = getAppProperty("FORM_ID");
var baseURL = getAppProperty("AGILE_BASE_URL") + enviromnentId;
var authorizationToken = getAppProperty("AUTH_TOKEN");
var hookUrl = getAppProperty("ZAPIER_URL");

//NÃO ALTERAR A PARTIR DESTE PONTO
console.log('initializing sync op '+baseURL);
var timestampLastItem = new Date().getTime();


formDetailURL = baseURL + "/form/" + formId;
//Pega o esqueleto do formulário que será sincronizado
request.get({ url: formDetailURL, headers: { "Authorization": authorizationToken, "X-AGILE-CLIENT": "EXTERNAL_APP" } }, function optionalCallback(err, httpResponse, bodyFormDetail) {
  if (err || httpResponse.statusCode != 200) {
    return console.error('request return http status ' + httpResponse.statusCode + ', error:', err);
  }

  console.log('Form detail retrieved successfully!');
  formObj = JSON.parse(bodyFormDetail);
  console.log('Form name found:',formObj.name);


  var formFields = {};
  console.log('Form Fields readed:');
  for (var i = 0; i < formObj.formFields.length; i++) {
    element = formObj.formFields[i];
    if (element.deleted == false) {
      formFields[element.id] = element.information.label;
      console.log(element.id + " - " + element.information.label);
    }
  }

  function executeSync() {
    //Executa a sincronização de pesquisas respondidas
    syncUrl = baseURL + "/survey/sync/timestamp/" + timestampLastItem + "?formId=" + formId + "&size=1&status=ANSWERED&ignoreExclude=true";

    console.log("requesting URL: " + syncUrl);
    request.get({ url: syncUrl, headers: { "Authorization": authorizationToken, "X-AGILE-CLIENT": "EXTERNAL_APP" } }, function optionalCallback(err, httpResponse, bodySync) {
      if (err || httpResponse.statusCode != 200) {
        return console.error('request return http status ' + httpResponse.statusCode + ', error:', err);
      }
      console.log('Sync detail retrieved successlly!  Server responded with:', bodySync);
      syncObj = JSON.parse(bodySync);
      readSurveySync(syncObj);
    });
  }

  //Lógica de interpretação do objeto de retorno SyncSurvey
  function readSurveySync(syncObj) {

    //Seta o timestamp para a próxima sync
    if (syncObj.timestampLastItem != null && syncObj.timestampLastItem != undefined) {
      timestampLastItem = syncObj.timestampLastItem;
    }

    //Verifica se voltou algo no sync
    if (syncObj.items == null || syncObj.items == undefined || syncObj.items[0] == null || syncObj.items[0] == undefined) {
      console.log("no itens to sync now");
      return;
    }

    //Verifica se existem dados respondidos na survey
    surveyItem = syncObj.items[0];
    if (surveyItem.surveyData == null || surveyItem.surveyData == undefined || surveyItem.surveyData[0] == null || surveyItem.surveyData[0] == undefined) {
      console.log("no itens to sync now");
      return;
    }

    //Ignora se a pesquisa não estiver respondida
    if (surveyItem.status != "ANSWERED") {
      console.log("survey id " + surveyItem.id + " not answed, skipping to next survey");
      return;
    }

    if (surveyItem.skus != null && surveyItem.skus != undefined && surveyItem.skus.length > 0) {
      readSkuSurvey(surveyItem);
    } else {
      readDefaultSurvey(surveyItem);
    }
  }

  //Se for uma pesquisa relacionada a SKU
  function readSkuSurvey(surveyItem) {

    for (var y = 0; y < surveyItem.skus.length; y++) {
      var sku = surveyItem.skus[y];
      var objToHook = {};
      //Preenche dados do SKu
      objToHook.sku = fillSkuData(sku.id);
      //Transforma o objeto de respostas da pesquisa fazendo o de-para nos campos do formulário
      for (var i = 0; i < surveyItem.surveyData.length; i++) {
        element = surveyItem.surveyData[i];
        if (element.sku == null || element.sku == undefined || element.sku.id == sku.id) {
          console.log(formFields[element.formField.id] + " - " + element.value);
          objToHook[formFields[element.formField.id]] = element.value;
        }
      }
      objToHook = fillDefaultSurveyData(objToHook);

      hookObj(objToHook);
    }
  }

  //Se for uma pesquisa sem relação com entidades
  function readDefaultSurvey(surveyItem) {
    var objToHook = {};
    //Transforma o objeto de respostas da pesquisa fazendo o de-para nos campos do formulário
    for (var i = 0; i < surveyItem.surveyData.length; i++) {
      element = surveyItem.surveyData[i];
      console.log(formFields[element.formField.id] + " - " + element.value);
      objToHook[formFields[element.formField.id]] = element.value;

    }
    objToHook = fillDefaultSurveyData(objToHook);

    hookObj(objToHook);
  }

  function fillDefaultSurveyData(objToHook) {
    objToHook["id"] = surveyItem.id;
    objToHook["repliedAt"] = surveyItem.repliedAt;
    objToHook["assignedTo"] = surveyItem.assignedTo;
    objToHook["pointOfSale"] = surveyItem.pointOfSale;
    return objToHook;
  }

  function fillSkuData(skuId) {
    skuURL = baseURL + "/sku/" + skuId;
    var skuRequest = syncRequest('GET', skuURL, {
      headers: {
        'Authorization': authorizationToken,
        "X-AGILE-CLIENT": "EXTERNAL_APP"
      },
    });
    var responseObj = JSON.parse(skuRequest.getBody('utf8'));

    var skuObj = {};
    skuObj.id = responseObj.id;
    skuObj.name = responseObj.name;
    skuObj.barCode = responseObj.barCode;
    skuObj.externalCode = responseObj.externalCode;

    if (responseObj.customFields != null && responseObj.customFields != undefined && responseObj.customFields.length > 0) {
      for (var i = 0; i < responseObj.customFields.length; i++) {
        var customField = responseObj.customFields[i];
        skuObj['customField_' + customField.name] = customField.value;
      }
    }
    console.log(skuObj);
    return skuObj;
  }

  function hookObj(objToHook) {
    objToHookJson = JSON.stringify(objToHook);

    //Envia o objeto transformado no webhook
    request.post({ url: hookUrl, body: objToHookJson }, function optionalCallback(err, httpResponse, body) {
      if (err || httpResponse.statusCode != 200) {
        return console.error('request return http status ' + httpResponse.statusCode + ', error:', err);
      }
      console.log('Upload successful!  Server responded with:', body);
    });
  }

  //Roda a lógica
  setInterval(executeSync, getAppProperty("APP_INTERVAL"))
});