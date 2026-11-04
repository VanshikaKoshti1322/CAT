CAT.Email.formLoad = async function (executionContext) {
    try {
        var formContext = executionContext.getFormContext();
        var directionCode = formContext.getAttribute("directioncode")?.getValue(); // true = outgoing

        if (formContext.ui.getFormType() !== 1) {
            if ((formContext.ui.getFormType() !== 2) && (directionCode !== true)) {
                return;
            }
        }

        await requiredToandSubject(formContext);

        var regardingObj = formContext.getAttribute("regardingobjectid").getValue();
        if (!regardingObj) {
            console.log("regardingObj not found");
            return;
        }

        var regardingValue = regardingObj[0];
        if (regardingValue.entityType !== "incident") {
            console.log("regardingObj is not case");
            return;
        }

        // Get Case Id
        var caseId = regardingValue.id.replace("{", "").replace("}", "");

        // TODO: replace cat_elevationtype / cat_assigneeemail with your real logical names
        var caseQuery =
            "?$select=emailaddress,cat_additionalemail2,cat_primarycontact,_customerid_value,_cat_requestedfrom_value," +
            "_parentcaseid_value,cat_elevationtype,cat_assigneeemail";

        var caseObject = await Xrm.WebApi.retrieveRecord("incident", caseId, caseQuery);

        /* ----------------------------------
           Existing CC Population Logic
        -----------------------------------*/
        if (caseObject.emailaddress || caseObject.cat_additionalemail2) {
            var ccField = formContext.getAttribute("cc");
            var ccParties = ccField.getValue() || [];

            if (caseObject.emailaddress) {
                if (!emailExistsInCC(ccParties, caseObject.emailaddress)) {
                    ccParties.push({
                        entityType: "unresolvedaddress",
                        id: "00000000-0000-0000-0000-000000000000",
                        name: caseObject.emailaddress
                    });
                }
            }

            if (caseObject.cat_additionalemail2) {
                if (!emailExistsInCC(ccParties, caseObject.cat_additionalemail2)) {
                    ccParties.push({
                        entityType: "unresolvedaddress",
                        id: "00000000-0000-0000-0000-000000000000",
                        name: caseObject.cat_additionalemail2
                    });
                }
            }

            ccField.setValue(ccParties);
        }

        /* ----------------------------------
           TO Population Logic
        -----------------------------------*/
        var ELEVATION_TYPE_MANUAL = 100000000; // TODO: replace with the real "Manual" option value

        var hasParent = !!caseObject._parentcaseid_value;
        var isManualElevation = caseObject.cat_elevationtype === ELEVATION_TYPE_MANUAL;
        var toField = formContext.getAttribute("to");

        if (hasParent && isManualElevation) {
            // Parent case + Manual elevation: To = Assignee Email text field
            if (caseObject.cat_assigneeemail) {
                toField.setValue([{
                    entityType: "unresolvedaddress",
                    id: "00000000-0000-0000-0000-000000000000",
                    name: caseObject.cat_assigneeemail
                }]);
            }
        } else {
            // Existing behaviour (no parent case / no elevation type)
            var primaryContact = caseObject.cat_primarycontact;
            if (primaryContact && primaryContact.length > 0) {
                var toParties = [];
                var isRequestedFor = primaryContact.indexOf(100000000) > -1;
                var isRequestedBy = primaryContact.indexOf(100000001) > -1;

                // Requested For selected
                if (isRequestedFor && caseObject._customerid_value) {
                    var customerType =
                        caseObject["_customerid_value@Microsoft.Dynamics.CRM.lookuplogicalname"];
                    var customerName = "";

                    if (customerType === "contact") {
                        var contact = await Xrm.WebApi.retrieveRecord(
                            "contact", caseObject._customerid_value, "?$select=fullname");
                        customerName = contact.fullname;
                    } else if (customerType === "account") {
                        var account = await Xrm.WebApi.retrieveRecord(
                            "account", caseObject._customerid_value, "?$select=name");
                        customerName = account.name;
                    }

                    toParties.push({
                        id: caseObject._customerid_value,
                        entityType: customerType,
                        name: customerName
                    });
                }

                // Requested By selected
                if (isRequestedBy && caseObject._cat_requestedfrom_value) {
                    var requestedBy = await Xrm.WebApi.retrieveRecord(
                        "contact", caseObject._cat_requestedfrom_value, "?$select=fullname");
                    toParties.push({
                        id: caseObject._cat_requestedfrom_value,
                        entityType: "contact",
                        name: requestedBy.fullname
                    });
                }

                toField.setValue(toParties);
            }
        }

        await setEmailTemplateByBrand(formContext);
    }
    catch (error) {
        console.log(`FormLoad Failed : ${error.message}`);
        alert(error.message);
    }
};
