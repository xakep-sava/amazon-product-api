'use strict'

const rp = require('request-promise');
const { jar } = require('request');
const fs = require('fs');
const Bluebird = require('bluebird');
const cheerio = require('cheerio');
const ora = require('ora');
const spinner = ora('Amazon Scraper on Duty');
const Json2csvParser = require('json2csv').Parser;

const productsParser = new Json2csvParser({ fields: ['title', 'price', 'rating', 'reviews', 'score', 'url', 'sponsored', 'discounted', 'before_discount', 'asin' ] });
const reviewsParser = new Json2csvParser({ fields: ['id', 'review_data', 'name', 'rating', 'title', 'review' ] });


class AmazonScraper{
    constructor({ keyword, number, sponsored, proxy, cli, save, scrapeType, asin, sort}){
        this._mainHost = `https://www.amazon.com/`;
        this._cookieJar = jar();
        this._scrapedProducts = {};
        this._endProductList = [];
        this._keyword = keyword;
        this._number = parseInt(number) || 10;
        this._continue = true;
        this._searchPage = 1;
        this._sponsored = sponsored || false;
        this._proxy = proxy;
        this._save = save || false;
        this._cli = cli || false;
        this._scrapeType = scrapeType;
        this._asin = '' || asin;
        this._sort = false || sort;
    }

    _request({uri, headers, method, qs, json, body, form, timeout}){
        return new Promise( async (resolve, reject) => {
            try{
                let response = await rp({
                    uri: uri ? `${this._mainHost}${uri}` : this._mainHost,
                    method,
                    ...(qs ? { qs } : {}),
                    ...(body ? { body } : {}),
                    ...(form ? { form } : {}),
                    'headers':{
                        'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:69.0) Gecko/20100101 Firefox/69.0',
                        ...headers,
                        'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'accept-language':'en-US,en;q=0.5',
                        'accept-encoding':'gzip, deflate, br',
                        'te':'trailers',
                    },
                    ...(json ?{ json: true } : {}),
                    'gzip':true,
                    'jar': this._cookieJar,
                    'resolveWithFullResponse': true,
                    ...(this._proxy ? {proxy:`https://${this._proxy}/`} : {}),
                });

                resolve(response);
            } catch(error){
                reject(error)
            }
        })
    }

    _openMainPage(){
        return new Promise( async (resolve, reject) => {
            let request = {
                'method': 'GET',
            }
            try{
                resolve(await this._request(request));
            } catch(error){
                reject(error)
            }
        })
    }

    _startScraper(){
        return new Promise( async (resolve, reject) => {
            if (this._scrapeType === 'products'){
                if (!this._keyword){
                    return reject('Keyword is missing');
                }
                if (this._number>100){
                    return reject('Wow.... slow down cowboy. Maximum you can get is 100 products');
                }
                if (typeof(this._sponsored)!=='boolean'){
                    return reject('Sponsored can only be {true} or {false}');
                }
            }
            if (this._scrapeType === 'reviews'){
                if (!this._asin){
                    return reject('ASIN is missing');
                }
                if (this._number>200){
                    return reject('Wow.... slow down cowboy. Maximum you can get is 200 reviews');
                }
            }
            if(this._cli){
                spinner.start()
            }
            
            await this._openMainPage();
            while(this._continue){
                if (this._endProductList.length>=this._number){
                    break;
                }
                try{
                    let body = await this._initSearch();
                    if (this._scrapeType === 'products'){
                        this._grabProduct(body);
                    }
                    if (this._scrapeType === 'reviews'){
                        this._grabReviews(body);
                    }
                }catch(error){
                    break;
                }
            }

            if (this._sort){
                if (this._scrapeType === 'products'){
                    this._endProductList.sort((a,b)=>{
                        return b.score-a.score;
                    })
                }
                if (this._scrapeType === 'reviews'){
                    this._endProductList.sort((a,b)=>{
                        return b.rating-a.rating;
                    })
                }
            }
            if (this._save){
                if (this._scrapeType === 'products'){
                    fs.writeFileSync(`${Date.now()}_products.csv`, productsParser.parse(this._endProductList));
                }
                if (this._scrapeType === 'reviews'){
                    fs.writeFileSync(`${Date.now()}_${this._asin}_reviews.csv`, reviewsParser.parse(this._endProductList));
                }
            }
            if (this._cli){
                spinner.stop()
            }
            resolve(this._endProductList)
        })
    }

    _initSearch(){
        return new Promise( async (resolve, reject) => {
            let request;
            if (this._scrapeType === 'products'){
                request = {
                    'method': 'GET',
                    'uri': 's',
                    'qs':{
                        'k': this._keyword,
                        ...(this._searchPage>1 ? {'page': this._searchPage, 'ref': `sr_pg_${this._searchPage}` }: {})
                    },
                    'headers':{
                        'referer':'https://www.amazon.com/',
                    }
                }
            }
            if (this._scrapeType === 'reviews'){
                request = {
                    'method': 'GET',
                    'uri': `product-reviews/${this._asin}/`,
                    'qs':{
                        ...(this._searchPage>1 ? {'pageNumber': this._searchPage }: {})
                    },
                    'headers':{
                        'referer':'https://www.amazon.com/',
                    }
                }
            }
            try{
                let response = await this._request(request);
                this._searchPage++;
                resolve(response.body);
            } catch(error){
                reject(error)
            }
        })
    }

    _grabReviews(body){
        let $ = cheerio.load(body.replace(/\s\s+/g, '').replace(/\n/g, ''));
        let reviewsList = $('.a-section.a-spacing-none.review-views.celwidget')[0].children;
        let scrapingResult = {};
        for(let i=0; i<reviewsList.length; i++){
            let totalInResult = Object.keys(scrapingResult).length+this._endProductList.length;
            if (totalInResult >=this._number){
                break;
            }
            if (!reviewsList[i].attribs['id']){
                continue;
            }
            scrapingResult[reviewsList[i].attribs['id']] = { id: reviewsList[i].attribs['id'] }
        }
        for (let key in scrapingResult){
            let search = $(`#${key} [data-hook="review-date"]`);

            try{
                scrapingResult[key].review_data = search[0].children[0].data
            }catch(error){
                continue;
            }
        }
        for (let key in scrapingResult){
            let search = $(`#${key} .a-profile-name`);

            try{
                scrapingResult[key].name = search[0].children[0].data
            }catch(error){
                continue;
            }
        }
        for (let key in scrapingResult){
            let search = $(`#${key} [data-hook="review-star-rating"]`);

            try{
                scrapingResult[key].rating = parseFloat(search[0].children[0].children[0].data.split(' ')[0])
            }catch(error){
                continue;
            }
        }
        for (let key in scrapingResult){
            let search = $(`#${key} [data-hook="review-title"]`);

            try{
                scrapingResult[key].title = $(search[0]).text().toString()
            }catch(error){
                continue;
            }
        }
        for (let key in scrapingResult){
            let search = $(`#${key} [data-hook="review-body"]`);

            try{
                scrapingResult[key].review = $(search[0]).text()
            }catch(error){
                continue;
            }
        }
        for(let key in scrapingResult){
            this._endProductList.push(scrapingResult[key])
        }
        return;

    }
    
    _grabProduct(body){
        let $ = cheerio.load(body.replace(/\s\s+/g, '').replace(/\n/g, ''));
        let productList = $('div[data-index]');
        let scrapingResult = {};
        for(let i=0; i<productList.length; i++){
            let totalInResult = Object.keys(scrapingResult).length+this._endProductList.length;
            if (totalInResult >=this._number){
                break;
            }
            if (!productList[i].attribs['data-asin']){
                continue;
            }
            scrapingResult[productList[i].attribs['data-asin']] = { asin: productList[i].attribs['data-asin'], discounted: false, sponsored: false, reviews:0, rating:0, score:0 }
        }

        for (let key in scrapingResult){
            let search = $(`div[data-asin=${key}] .a-offscreen`);
            try{
                scrapingResult[key].price = search[0].children[0].data;
                if (search.length>1){
                    scrapingResult[key].before_discount = search[1].children[0].data;
                    scrapingResult[key].discounted = true;
                }
            }catch(err){
                continue;
            }
        }

        for (let key in scrapingResult){
            let search = $(`div[data-asin=${key}] .a-icon-star-small`);
            try{
                scrapingResult[key].rating = parseFloat(search[0].children[0].children[0].data)
                scrapingResult[key].reviews = parseInt(search[0].parent.parent.parent.next.attribs['aria-label'].replace(/\,/g, ''));
                scrapingResult[key].score = parseFloat(scrapingResult[key].rating*scrapingResult[key].reviews).toFixed(2);
            }catch(err){
                continue;
            }
        }
        for (let key in scrapingResult){
            let search = $(`div[data-asin=${key}] [data-image-source-density="1"]`);
            try{
                scrapingResult[key].title = search[0].attribs.alt
                scrapingResult[key].url = `https://www.amazon.com${search[0].parent.parent.attribs.href}`;
            }catch(err){
                continue;
            }
        }
        for(let key in scrapingResult){
            this._endProductList.push(scrapingResult[key])
        }
        return;
    }
}

module.exports = AmazonScraper;