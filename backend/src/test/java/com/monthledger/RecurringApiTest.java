package com.monthledger;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:recurring;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH")
@AutoConfigureMockMvc
@DirtiesContext
class RecurringApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    private ResultActions send(String method, String url, String body) throws Exception {
        var req = method.equals("POST") ? post(url) : put(url);
        return mvc.perform(req.contentType(MediaType.APPLICATION_JSON).content(body));
    }
    private String item(String name, String kind, String amount, int category, int day) {
        return "{\"name\":\"" + name + "\",\"kind\":\"" + kind + "\",\"amount\":" + amount + ",\"categoryId\":" + category + ",\"dayOfMonth\":" + day + ",\"paymentMode\":\"UPI\"}";
    }

    @Test
    void listsActiveItemsByDayAndStopsOnes() throws Exception {
        send("POST", "/api/recurring", item("Gym fee", "EXPENSE", "1500", 21, 10)).andExpect(status().isCreated());
        String home = send("POST", "/api/recurring", item("Home money", "EXPENSE", "15000", 20, 5)).andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();
        // Other tests in this class share the database, so check by name, not by count.
        mvc.perform(get("/api/recurring")).andExpect(jsonPath("$[*].name", hasItems("Home money", "Gym fee")))
            .andExpect(jsonPath("$[*].dayOfMonth", everyItem(greaterThanOrEqualTo(1))));
        long id = json.readTree(home).get("id").asLong();
        send("PUT", "/api/recurring/" + id, item("Home money", "EXPENSE", "15000", 20, 5).replace("}", ",\"active\":false}")).andExpect(status().isOk());
        mvc.perform(get("/api/recurring")).andExpect(jsonPath("$[*].name", not(hasItem("Home money")))).andExpect(jsonPath("$[*].name", hasItem("Gym fee")));
    }

    @Test
    void validatesKindCategoryAndDay() throws Exception {
        send("POST", "/api/recurring", item("Salary", "EXPENSE", "31000", 1, 5)).andExpect(status().isBadRequest());     // Salary is income
        send("POST", "/api/recurring", item("Gym", "EXPENSE", "1500", 21, 0)).andExpect(status().isBadRequest());
        send("POST", "/api/recurring", item("Gym", "EXPENSE", "1500", 21, 32)).andExpect(status().isBadRequest());
        send("POST", "/api/recurring", item("Out", "SAVING_WITHDRAWAL", "100", 17, 5)).andExpect(status().isBadRequest());
        send("POST", "/api/recurring", item(" ", "EXPENSE", "100", 21, 5)).andExpect(status().isBadRequest());
        send("POST", "/api/recurring", item("Salary", "INCOME", "31000", 1, 31)).andExpect(status().isCreated());
    }

    @Test
    void entryCanPayAMatchingItemOnly() throws Exception {
        String gym = send("POST", "/api/recurring", item("Gym fee", "EXPENSE", "1500", 21, 10)).andReturn().getResponse().getContentAsString();
        long id = json.readTree(gym).get("id").asLong();
        String paid = "{\"date\":\"2026-11-10\",\"kind\":\"EXPENSE\",\"amount\":1500,\"categoryId\":21,\"paymentMode\":\"UPI\",\"note\":null,\"goalId\":null,\"recurringId\":" + id + "}";
        send("POST", "/api/entries", paid).andExpect(status().isCreated()).andExpect(jsonPath("$.recurringId").value(id));
        String wrongKind = "{\"date\":\"2026-11-10\",\"kind\":\"SAVING\",\"amount\":1500,\"categoryId\":17,\"paymentMode\":\"UPI\",\"note\":null,\"goalId\":null,\"recurringId\":" + id + "}";
        send("POST", "/api/entries", wrongKind).andExpect(status().isBadRequest());
    }
}
