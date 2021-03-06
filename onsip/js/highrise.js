/** Highrise library for OnSIP Call Assistant **/

var HIGHRISE = {
  'companies'   : [],
  'contacts'    : [],
  'ts'          : undefined,
  'base_url'    : '',
  'token'       : '',
  'attempts'    : 0,
  'log_context' : 'HIGHRISE',
  'timeout_id'  : undefined,
  'refresh'     : 60000 * 60 /** Refresh every 60 min **/
};

HIGHRISE.verifyToken = function(call, highrise_url, token) {
  var xhr = new XMLHttpRequest(), ok = false, tmout = 30000,
    xml, xmlobject, tokenNode, tv;

  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        ok = true;
        xml = xhr.responseText;
        xmlobject = (new DOMParser()).parseFromString(xml, "text/xml");
        tokenNode = xmlobject.getElementsByTagName("token");
        if (tokenNode && tokenNode.length > 0 && tokenNode[0].firstChild) {
          tv = tokenNode[0].firstChild.nodeValue;
          if (tv && tv.length > 0 && tv !== token) {
            call.onError('Token ' + token + ' is invalid');
            return;
          }
        }
	call.onSuccess();
      } else {
        call.onError(xhr.status);
      }
    }
  };

  this.base_url = highrise_url;
  this.token = token;

  var a = function() {
    if (!ok) {
      xhr.abort();
      if(call && call.onError) {
        call.onError('aborted');
      }
    }
  };

  xhr.open('GET', this.base_url + '/me.xml?r=' + new Date().getTime(), true, this.token, 'X');
  setTimeout(a, tmout);
  xhr.send();
};

HIGHRISE.clearCache = function() {
  this.contacts = [];
  this.companies = [];
};

HIGHRISE._getIdentity = function(customer) {
  var full_name;

  if (customer.first_name && customer.last_name) {
    full_name = customer.first_name + ' ' + customer.last_name;
    if (trim(full_name).length === 0) {
      full_name = undefined;
    }
  }
  if (!full_name && (customer.company_name)) {
    full_name = customer.company_name;
    if (trim(full_name).length === 0) {
      full_name = undefined;
    }
  }
  return full_name;
};

HIGHRISE.encodeSpecialChars = function(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/'/g, "&apos;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

HIGHRISE._createDefaultNote = function(customer, user_tz, incoming, to_aor) {
  var nt, full_name, tz;

  tz = getDateAndTime(getTimezoneAbbrevation(user_tz));
  full_name = this._getIdentity(customer);
  to_aor = (to_aor && "(sip:" + to_aor + ")") || "";
  if (full_name && full_name.length > 0) {
    full_name = this.encodeSpecialChars(full_name);
    if (incoming) {
      nt = "<note><body>" + full_name + " called  @ " + tz + " " + to_aor + "</body></note>";
    } else {
      nt = "<note><body>Called " + full_name + " @ " + tz + " " + to_aor + "</body></note>";
    }
  }

  return nt;
};


HIGHRISE._createReceiveNote = function(customer, user_tz, incoming, from, to_aor) {
  var nt, full_name, tz;

  tz = getDateAndTime(getTimezoneAbbrevation(user_tz));
  full_name = this._getIdentity(customer);
  to_aor = (to_aor && "(sip:" + to_aor + ")") || "";
  if (full_name && full_name.length > 0) {
    full_name = this.encodeSpecialChars(full_name);
    if (incoming) {
      if (from) {
        nt = "<note><body>Received call on Line: " + full_name + " from " + from + " @ " + tz + " " + to_aor + "</body></note>";
      } else {
        nt = "<note><body>Received call on Line: " + full_name + " called  @ " + tz + " " + to_aor + "</body></note>";
      }
    }
  }
  return nt;
};

HIGHRISE.postReceiveNote = function(customer, user_tz, incoming, from, to_aor) {
  var note;
  if (customer && incoming) {
    note = this._createReceiveNote(customer, user_tz, incoming, from, to_aor);
    if (note && note.length) {
      this.postNoteToProfile(customer, note);
    }
  }
};

/**
  Note has the convention <note><body> {STUFF} </body></note>
*/
HIGHRISE.postNote = function (customer, user_tz, incoming, to_aor) {
  var note;

  if (customer) {
    note = this._createDefaultNote(customer, user_tz, incoming, to_aor);
    if (note && note.length) {
      this.postNoteToProfile(customer, note);
    }
  }
};

/**
  Find the person or company by phone number
  Amended somewhat:
  The customer_from_context argument is scraped
  from the Highrise website, where the click-to-call phone number link
  was clicked. With the enhancement of this variable, we modify the logic such that
  If the customer_from_context was a valid argument
  we search all the phone numbers that match our customer list (cached)
  and verify that a matched phone number also matches the name scraped from the site
  [i.e. customer_from_context].
  If said argument was not passed through, we simply find a match company if one exists
  Followed by a matching customer if company does not exist
*/
HIGHRISE.findContact = function (phone_number, customer_from_context) {
  var  i, j, len, customer, f_name, l_name, ff_name, fl_name, b_cfc_ok, company;

  customer_from_context = customer_from_context ? trim(customer_from_context.toLowerCase()) : '';
  b_cfc_ok = (customer_from_context.length > 0);
  dbg.log (this.log_context, 'Searching customer using customer_from_context - [' + customer_from_context + '] ');
  /** Find company first **/
  for (i = 0, len = this.companies.length; i < len; i += 1) {
    for (j = 0; j < this.companies[i].phone_numbers.length; j += 1) {
      if (this.companies[i].phone_numbers[j].phone_number === phone_number) {
  	customer      = this.companies[i];
   	customer.type = 'companies';
	dbg.log (this.log_context, 'Company name: ' + customer.company_name.toLowerCase() + ' == ' + customer_from_context + ' - ' + b_cfc_ok);
	if(b_cfc_ok) {
	  if(trim(customer.company_name).toLowerCase() == customer_from_context) {
   	    dbg.log (this.log_context, 'Found company with valid customer context ' + customer_from_context);
	    return customer;
	  }
	} else {
	  dbg.log (this.log_context, 'Found company, returning company - ' + customer_from_context);
	  return customer;
	}
      }
    }
  }
  company = customer;
  for (i = 0, len = this.contacts.length; i < len; i += 1) {
    for (j = 0; j < this.contacts[i].phone_numbers.length; j += 1) {
      if (this.contacts[i].phone_numbers[j].phone_number === phone_number) {
	customer = this.contacts[i];
	customer.type = 'people';
	dbg.log (this.log_context, 'Individual  name: ' + customer.first_name + ' ' + customer.last_name  + ' == ' + customer_from_context + ' - ' + b_cfc_ok);
	if(b_cfc_ok) {
	  dbg.log (this.log_context, 'Individual  name: ' + customer.first_name + ' ' + customer.last_name  + ' == ' + customer_from_context);
	  f_name = '';
	  l_name = '';
	  if (customer.first_name) {
	    f_name = customer.first_name;
	  }
	  if (customer.last_name) {
	    l_name = customer.last_name;
	  }
	  ff_name = f_name.toLowerCase() + ' ' + l_name.toLowerCase();
	  fl_name = l_name.toLowerCase() + ' ' + f_name.toLowerCase();
	  ff_name = trim(ff_name);
	  fl_name = trim(fl_name);
	  if(ff_name == customer_from_context || fl_name == customer_from_context){
	    dbg.log (this.log_context, 'Found individual with valid customer context ' + customer_from_context);
	    return customer;
	  }
	}
	else {
	  return customer;
	}
      }
    }
  }

  /**
    The only reason this case can exist
    is if a customer_from_context exists
    but that customer does not have a valid number
  */
  if (company && company.type == 'companies') {
    dbg.log (this.log_context, 'A customer context was given [' + customer_from_context + '] but no number was found');
    return company;
  }

  return customer;
};

/** Normalize the phone number **/
HIGHRISE._normalizePhoneNumber = function(phone_number) {
  var clean_phone_num, clean_phone_ext;

  clean_phone_ext = getPhoneExtension(phone_number);
  clean_phone_num = removeExtention(phone_number);
  clean_phone_num = cleanPhoneNo(clean_phone_num);
  if (clean_phone_num.length === 10) {
    clean_phone_num = '1' + clean_phone_num;
  }
  return clean_phone_num;
};

HIGHRISE.postNoteToProfile = function(customer, note, call) {
  var xhr = new XMLHttpRequest(), that = this, ok = false;

  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) {
      return false;
    }
    if (xhr.status > 299) {
      if (that.call && that.call.onError) {
	that.call.onError(xhr.status);
      }
    } else {
      ok = true;
      if (that.call && that.call.onSuccess) {
	that.call.onSuccess();
      }
    }
    return true;
  };

  xhr.open("POST", this.base_url + "/" +  customer.type + "/" + customer.id + "/notes.xml", true, this.token, 'X');
  xhr.send(note);
};

HIGHRISE.init = function(pref) {
  var to_func, that = this;

  this.base_url = pref.get('highriseUrl');
  this.token = pref.get ('highriseToken');
  this.attempts = 0;

  if (!(this.base_url && this.token)) {
    dbg.log (this.log_context, 'Init Failed ' + this.base_url + ' -- ' + this.token);
    return;
  }

  dbg.log (this.log_context, 'Get Contacts & Company names');
  this._getContacts ({
    onSuccess: function(c) {
      to_func = that._recycle.bind (that);
      that.ts = new Date();
      that.attempts = 0;
      if (that.timeout_id) {
        clearInterval(that.timeout_id);
      }
      dbg.log (that.log_context, 'In function init, will SETUP _recyle ' + that.timeout_id);
      that.timeout_id = setInterval(to_func, that.refresh);
      dbg.log (that.log_context, 'Got contacts @ ' + that.ts);
    },
    onError: function(status) {
      to_func = that._recycle.bind (that);
      if (that.timeout_id) {
	clearInterval(that.timeout_id);
      }
      that.timeout_id = setInterval(to_func, that.refresh);
      dbg.log (that.log_context, 'Error ' + status);
    }
  });
  this._getCompanies ({
    onSuccess: function (c) {
      that.ts = new Date();
      dbg.log (that.log_context, 'Got companies @ ' + that.ts);
    },
    onError: function (status) {
      dbg.log (that.log_context, 'Error ' + status);
    }
  });
};

HIGHRISE._recycle = function () {
  var to_func, failed_to, that = this;
  dbg.log (this.log_context, 'Recycle contacts & companies');
  this._getContacts ({
    onSuccess: function (c) {
      to_func = that._recycle.bind (that);
      that.attempts = 0;
      if (!that.timeout_id) {
	that.timeout_id = setInterval(to_func, that.refresh);
      }
      dbg.log (that.log_context, 'Recycled ' + c.length + ' contacts @ ' + new Date());
    },
    onError: function (status) {
      that.attempts += 1;
      if (that.attempts > 5) {
	if (that.timeout_id) {
          clearInterval(that.timeout_id);
	  that.timeout_id = null;
	}
	dbg.log (that.log_context, 'Failed to connect on ' + that.attempts + ' attempts');
      }
      dbg.log (that.log_context, 'Error ' + status);
    }
  });
  this._getCompanies ({
    onSuccess : function (c) {
      dbg.log (that.log_context, 'Recycled ' + c.length + '  companies @ ' + new Date());
    },
    onError   : function (status) {
      dbg.log (that.log_context, 'Error ' + status);
    }
  });
};

HIGHRISE._getContacts = function (call) {
  var xhr  = new XMLHttpRequest(), that = this,
    ok = false, tmout= 90000;

  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) {
      return false;
    }
    if (xhr.status !== 200) {
      call.onError (xhr.status);
    } else{
      ok = true;
      that._parseContactsXML (xhr.responseText);
      call.onSuccess         (that.contacts);
    }
    return true;
  };

  var a = function () {
    if (!ok) {
      xhr.abort();
      dbg.log (that.log_context, 'ABORTING xhr call to GetContacts');
      if (call && call.onError) {
        call.onError('aborted getContacts');
      }
    }
  };

  xhr.open("GET", this.base_url + '/people.xml', true, this.token, 'X');
  setTimeout(a, tmout);
  xhr.send();
};

/**
  Retrieve companies from highrise
*/
HIGHRISE._getCompanies = function (call) {
  var xhr = new XMLHttpRequest(), that = this,
    ok = false, tmout= 90000;

  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) {
      return false;
    }
    if (xhr.status !== 200) {
      call.onError(xhr.status);
    } else {
      ok = true;
      that._parseCompaniesXML(xhr.responseText);
      call.onSuccess(that.companies);
    }
    return true;
   };

   var a = function () {
     if (!ok) {
       xhr.abort();
       dbg.log (that.log_context, 'ABORTING xhr call to GetCompanies');
       if (call && call.onError) {
	 call.onError('aborted getCompanies');
       }
     }
   };

   xhr.open("GET", this.base_url + '/companies.xml', true, this.token, 'X');
   setTimeout(a, tmout);
   xhr.send();
};

HIGHRISE._parseContactsXML = function(xml) {
  var i, j, phone_num, first_name, last_name, pn_nodes = [],
    location, person_id, len, xmlobject, root_node;

  xmlobject = (new DOMParser()).parseFromString(xml, "text/xml"),
  root_node = xmlobject.getElementsByTagName("people");
  this.contacts = [];
  if (root_node && root_node.length > 0) {
    root_node = root_node[0];
  } else {
    return;
  }
  var person_nodes = root_node.getElementsByTagName("person");
  for (i = 0, len = person_nodes.length; i < len ; i += 1) {
    person_id = person_nodes[i].getElementsByTagName ("id")[0].firstChild.nodeValue;
    last_name = person_nodes[i].getElementsByTagName ("last-name");
    if (last_name && last_name.length > 0 && last_name[0].firstChild) {
      last_name = last_name[0].firstChild.nodeValue;
    } else {
      last_name = '';
    }
    first_name = person_nodes[i].getElementsByTagName("first-name");
    if (first_name && first_name.length > 0 && first_name[0].firstChild) {
      first_name = first_name[0].firstChild.nodeValue;
    } else {
      first_name = '';
    }
    pn_nodes = person_nodes[i].getElementsByTagName("phone-number");
    var phone_numbers_list = [];
    for (j = 0;  j < pn_nodes.length; j += 1) {
      phone_num = pn_nodes[j].getElementsByTagName("number");
      if (phone_num && phone_num.length > 0 && phone_num[0].firstChild) {
	phone_num = phone_num[0].firstChild.nodeValue;
	location = pn_nodes[j].getElementsByTagName("location");
	if (location && location.length > 0 && location[0].firstChild) {
	  location = location[0].firstChild.nodeValue;
	} else {
	  location = '';
	}
	phone_num  = this._normalizePhoneNumber(phone_num);
	var ph_obj = {
	  phone_number : phone_num,
	  location     : location
	};
	phone_numbers_list.push (ph_obj);
      }
    }
    if (phone_numbers_list.length > 0) {
      var person_obj = {
	"id"           : person_id,
	"first_name"   : first_name,
	"last_name"    : last_name,
	"phone_numbers": phone_numbers_list
      };
      this.contacts.push (person_obj);
    }
  }
};

HIGHRISE._parseCompaniesXML = function(xml) {
  var i, j, len, company_name, company_id, phone_num, pn_nodes = [],
    location, xmlobject, root_node;

  xmlobject = (new DOMParser()).parseFromString(xml, "text/xml");
  root_node = xmlobject.getElementsByTagName("companies");
  this.companies = [];
  if (root_node && root_node.length > 0) {
    root_node = root_node[0];
  } else {
    return;
  }
  var company_nodes = root_node.getElementsByTagName("company");
  for (i = 0, len = company_nodes.length; i < len; i += 1) {
    company_id = company_nodes[i].getElementsByTagName ("id")  [0].firstChild.nodeValue;
    company_name = company_nodes[i].getElementsByTagName ("name");
    if (company_name && company_name.length > 0 && company_name[0].firstChild) {
      company_name = company_name [0].firstChild.nodeValue;
      pn_nodes = company_nodes[i].getElementsByTagName ("phone-number");
      var phone_numbers_list = [];
      for (j = 0; j < pn_nodes.length; j += 1) {
	phone_num = pn_nodes[j].getElementsByTagName ("number");
	if (phone_num &&  phone_num.length > 0 && phone_num[0].firstChild) {
	  phone_num = phone_num[0].firstChild.nodeValue;
	  location  = pn_nodes[j].getElementsByTagName ("location");
	  if (location && location.length > 0 && location[0].firstChild) {
	    location = location[0].firstChild.nodeValue;
	  } else {
	    location = '';
	  }
	  phone_num = this._normalizePhoneNumber (phone_num);
	  var ph_obj = {
	    phone_number : phone_num,
	    location     : location
	  };
	  phone_numbers_list.push (ph_obj);
	}
      }
      if (phone_numbers_list.length > 0) {
	var company_obj = {
	  "id"           : company_id,
	  "company_name" : company_name,
	  "phone_numbers": phone_numbers_list
	};
	this.companies.push (company_obj);
      }
    }
  }
};