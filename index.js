var express = require('express');
var app = express();

 // create http request client to consume the QPX API
 var request = require("request");

 const PropertiesReader = require('properties-reader');
 const prop = PropertiesReader('app.properties');
 getProperty = (pty) => {return prop.get(pty);}
 

 //Seta Variaveis do app
 var enviromnentId = getProperty('agile.enviroment.id');
 var formId =  getProperty('agile.form.id');
 var baseURL = getProperty('agile.url')+enviromnentId;
 var authorizationToken = getProperty('agile.auth.token');
 var hookUrl = getProperty('zapier.hook.url');

//NÃO ALTERAR A PARTIR DESTE PONTO
console.log('initializing sync op');
var timestampLastItem = new Date().getTime();

formDetailURL = baseURL+"/form/"+formId;
//Pega o esqueleto do formulário que será sincronizado
request.get({url:formDetailURL, headers:{"Authorization":authorizationToken, "X-AGILE-CLIENT":"EXTERNAL_APP"}}, function optionalCallback(err, httpResponse, bodyFormDetail) {
    if (err || httpResponse.statusCode != 200) {
      return console.error('request return http status '+httpResponse.statusCode+', error:', err);
    }

    console.log('form detail retrieved successfully!  Server responded with:', bodyFormDetail);
    formObj = JSON.parse(bodyFormDetail);

    if(formObj.formPurpose != "NOT_RELATED_TO_PRODUCTS"){
      console.log('form purpose not supported: '+ formObj.formPurpose);
      return;
    }

    var formFields = {};
    console.log(formObj.deleted);
    for (var i = 0; i < formObj.formFields.length; i++) {
      element = formObj.formFields[i];
      formFields[element.id] = element.information.label;  
      console.log(element.id + " - "+ element.information.label);
    }

    function executeSync(){
      //Executa a sincronização de pesquisas respondidas
      syncUrl = baseURL+"/survey/sync/timestamp/"+timestampLastItem+"?formId="+formId+"&size=1&status=ANSWERED&ignoreExclude=true";
  
      console.log("requesting URL: "+syncUrl);
      request.get({url:syncUrl, headers:{"Authorization":authorizationToken, "X-AGILE-CLIENT":"EXTERNAL_APP"}}, function optionalCallback(err, httpResponse, bodySync) {
          if (err || httpResponse.statusCode != 200) {
            return console.error('request return http status '+httpResponse.statusCode+', error:', err);
          }
          console.log('Sync detail retrieved successlly!  Server responded with:', bodySync);
          syncObj = JSON.parse(bodySync);
          
          //Seta o timestamp para a próxima sync
          if(syncObj.timestampLastItem != null && syncObj.timestampLastItem != undefined){
            timestampLastItem = syncObj.timestampLastItem;
          }
          
          //Verifica se voltou algo no sync
          if(syncObj.items == null || syncObj.items == undefined || syncObj.items[0] == null || syncObj.items[0] == undefined){
            console.log("no itens to sync now");
            return;
          }
  
          //Verifica se existem dados respondidos na survey
          surveyItem = syncObj.items[0];
          if(surveyItem.surveyData == null || surveyItem.surveyData == undefined || surveyItem.surveyData[0] == null || surveyItem.surveyData[0] == undefined){
            console.log("no itens to sync now");
            return;
          }

          //Só pega dados de pesquisas respondidas
          if(surveyItem.status != "ANSWERED"){
            console.log("survey id "+surveyItem.id+" not answed, skipping to next survey");
            return;
          }
  
          var objToHook = {};
          //Transforma o objeto de respostas da pesquisa fazendo o de-para nos campos do formulário
          for (var i = 0; i < surveyItem.surveyData.length; i++) {
            element = surveyItem.surveyData[i];
            console.log(formFields[element.formField.id]+ " - "+ element.value);
            objToHook[formFields[element.formField.id]] = element.value;
            
          }
          objToHook["id"] = surveyItem.id;
          objToHook["repliedAt"] = surveyItem.repliedAt;
          objToHook["assignedTo"] = surveyItem.assignedTo;
          objToHook["pointOfSale"] = surveyItem.pointOfSale;

          objToHookJson = JSON.stringify(objToHook);
          
          //Envia o objeto transformado no webhook
          request.post({url:hookUrl, body: objToHookJson}, function optionalCallback(err, httpResponse, body) {
            if (err || httpResponse.statusCode != 200) {
              return console.error('request return http status '+httpResponse.statusCode+', error:', err);
            }
            console.log('Upload successful!  Server responded with:', body);
          });
        });
  }


  setInterval(executeSync,getProperty('app.interval'))
});





